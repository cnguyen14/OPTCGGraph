"""Comprehensive validation of AI deck builder intelligence.

Tests whether build_deck() produces ACTUALLY PLAYABLE, COMPETITIVE decks.
Requires a running Neo4j instance with populated OPTCG data.

Run: uv run pytest tests/test_deck_intelligence.py -v -s
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from neo4j import AsyncGraphDatabase

from backend.ai.deck_builder import build_deck
from backend.config import NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER
from backend.graph.queries import get_deck_synergies

# ── Module-level caches (survive across tests) ───────────

_leaders_cache: dict | None = None
_meta_cache: dict[str, set[str]] | None = None
_deck_cache: dict[str, dict] = {}


# ── Fixtures ──────────────────────────────────────────────


@pytest_asyncio.fixture
async def driver():
    drv = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    yield drv
    await drv.close()


@pytest_asyncio.fixture
async def test_leaders(driver):
    """Discover leaders in tiers from live data. Cached after first call."""
    global _leaders_cache
    if _leaders_cache is not None:
        return _leaders_cache

    async with driver.session() as session:
        r = await session.run("""
            MATCH (d:Deck)-[:USES_LEADER]->(c:Card)
            RETURN c.id AS id, c.name AS name, count(d) AS cnt
            ORDER BY cnt DESC LIMIT 30
        """)
        all_leaders = [dict(rec) async for rec in r]

        mc = await session.run("""
            MATCH (c:Card {card_type: 'LEADER'})-[:HAS_COLOR]->(color:Color)
            WITH c, count(color) AS color_count, collect(color.name) AS colors
            WHERE color_count >= 2
            RETURN c.id AS id, c.name AS name, colors
            LIMIT 5
        """)
        multi_color = [dict(rec) async for rec in mc]

        zd = await session.run("""
            MATCH (c:Card {card_type: 'LEADER'})
            WHERE NOT EXISTS { MATCH (:Deck)-[:USES_LEADER]->(c) }
            RETURN c.id AS id, c.name AS name
            LIMIT 3
        """)
        zero_deck = [dict(rec) async for rec in zd]

    popular = [leader for leader in all_leaders if leader["cnt"] >= 8][:3]
    mid_tier = [leader for leader in all_leaders if 3 <= leader["cnt"] < 8][:2]

    if len(popular) < 1 and all_leaders:
        popular = all_leaders[:1]

    _leaders_cache = {
        "popular": popular,
        "mid_tier": mid_tier,
        "multi_color": multi_color[:2],
        "zero_deck": zero_deck[:2],
    }
    return _leaders_cache


@pytest_asyncio.fixture
async def meta_cards_by_leader(driver, test_leaders):
    """Pre-fetch tournament staple cards for each leader with data."""
    global _meta_cache
    if _meta_cache is not None:
        return _meta_cache

    meta: dict[str, set[str]] = {}
    leaders_with_data = test_leaders["popular"] + test_leaders["mid_tier"]
    for leader in leaders_with_data:
        async with driver.session() as session:
            r = await session.run(
                """
                MATCH (d:Deck {leader_id: $lid})-[inc:INCLUDES]->(c:Card)
                WITH c.id AS id, count(DISTINCT d) AS deck_count
                ORDER BY deck_count DESC LIMIT 30
                RETURN id, deck_count
            """,
                lid=leader["id"],
            )
            meta[leader["id"]] = {rec["id"] async for rec in r}

    _meta_cache = meta
    return _meta_cache


async def get_or_build(driver, leader_id: str, strategy: str) -> dict:
    key = f"{leader_id}:{strategy}"
    if key not in _deck_cache:
        _deck_cache[key] = await build_deck(driver, leader_id, strategy)
    return _deck_cache[key]


# ── Helpers ───────────────────────────────────────────────


def compute_playability(
    result: dict,
    meta_ids: set[str] | None = None,
    synergy_edge_count: int = 0,
) -> float:
    """Composite playability score (0-100)."""
    validation = result["validation"]
    is_legal = validation["is_legal"]
    checks = validation["checks"]

    rule_names = {"DECK_SIZE", "COPY_LIMIT", "COLOR_MATCH", "LEADER_VALID", "NO_LEADER_IN_DECK"}
    quality_passes = sum(1 for c in checks if c["status"] == "PASS" and c["name"] not in rule_names)

    if meta_ids:
        deck_ids = {c["id"] for c in result["cards"]}
        overlap = len(deck_ids & meta_ids) / len(meta_ids)
    else:
        overlap = 0.0

    unique = result["unique_cards"]
    max_pairs = unique * (unique - 1) / 2 if unique > 1 else 1
    syn_density = synergy_edge_count / max_pairs

    four_copies = len(result.get("four_copy_cards", []))
    counters = [c.get("counter") or 0 for c in result["cards"]]
    avg_counter = sum(counters) / len(counters) if counters else 0

    return round(
        30 * (1 if is_legal else 0)
        + 20 * (quality_passes / 8)
        + 20 * min(overlap, 1.0)
        + 15 * min(syn_density / 0.10, 1.0)
        + 10 * (1 if four_copies >= 6 else 0)
        + 5 * (1 if avg_counter >= 900 else 0),
        1,
    )


# ── Suite 1: Rule Legality ────────────────────────────────


class TestRuleLegality:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("strategy", ["aggro", "midrange", "control"])
    async def test_popular_leaders_legal(self, driver, test_leaders, strategy):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], strategy)
            assert "error" not in result, f"Build failed: {leader['id']}: {result.get('error')}"
            assert result["validation"]["is_legal"], (
                f"{leader['name']} ({strategy}): ILLEGAL — "
                + str(
                    [
                        c["name"] + ": " + c["message"]
                        for c in result["validation"]["checks"]
                        if c["status"] == "FAIL"
                    ]
                )
            )
            assert result["total_cards"] == 50

    @pytest.mark.asyncio
    async def test_multi_color_leaders_legal(self, driver, test_leaders):
        if not test_leaders["multi_color"]:
            pytest.skip("No multi-color leaders")
        for leader in test_leaders["multi_color"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            assert "error" not in result, f"Build failed: {leader['id']}"
            assert result["validation"]["is_legal"]
            assert result["total_cards"] == 50

    @pytest.mark.asyncio
    async def test_zero_deck_leaders_legal(self, driver, test_leaders):
        if not test_leaders["zero_deck"]:
            pytest.skip("No zero-deck leaders")
        for leader in test_leaders["zero_deck"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                pytest.skip(f"No candidates for {leader['id']}")
            assert result["validation"]["is_legal"]


# ── Suite 2: Quality Metrics ──────────────────────────────


class TestQualityMetrics:
    @pytest.mark.asyncio
    async def test_popular_quality_score(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            checks = result["validation"]["checks"]
            rule_names = {
                "DECK_SIZE",
                "COPY_LIMIT",
                "COLOR_MATCH",
                "LEADER_VALID",
                "NO_LEADER_IN_DECK",
            }
            quality = [c for c in checks if c["name"] not in rule_names]
            passes = sum(1 for c in quality if c["status"] == "PASS")
            warns = [c["name"] for c in quality if c["status"] != "PASS"]
            assert passes >= 5, f"{leader['name']}: {passes}/8 quality — WARN: {warns}"

    @pytest.mark.asyncio
    async def test_counter_density(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            counters = [c.get("counter") or 0 for c in result["cards"]]
            avg = sum(counters) / len(counters)
            assert avg >= 600, f"{leader['name']}: avg counter {avg:.0f} (need ≥600)"

    @pytest.mark.asyncio
    async def test_four_copy_consistency(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            four_x = len(result.get("four_copy_cards", []))
            assert four_x >= 4, f"{leader['name']}: {four_x} 4x playsets (need ≥4)"


# ── Suite 3: Meta Alignment ──────────────────────────────


class TestMetaAlignment:
    @pytest.mark.asyncio
    async def test_popular_meta_overlap(self, driver, test_leaders, meta_cards_by_leader):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            meta_ids = meta_cards_by_leader.get(leader["id"], set())
            if not meta_ids:
                continue
            deck_ids = {c["id"] for c in result["cards"]}
            overlap = len(deck_ids & meta_ids)
            ratio = overlap / len(meta_ids)
            assert ratio >= 0.20, (
                f"{leader['name']}: {overlap}/{len(meta_ids)} ({ratio:.0%}) meta overlap (need ≥20%)"
            )

    @pytest.mark.asyncio
    async def test_mid_tier_meta_overlap(self, driver, test_leaders, meta_cards_by_leader):
        if not test_leaders["mid_tier"]:
            pytest.skip("No mid-tier leaders")
        for leader in test_leaders["mid_tier"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            meta_ids = meta_cards_by_leader.get(leader["id"], set())
            if not meta_ids:
                continue
            deck_ids = {c["id"] for c in result["cards"]}
            overlap = len(deck_ids & meta_ids)
            ratio = overlap / len(meta_ids)
            # Lower threshold for mid-tier leaders — they naturally have less meta overlap
            assert ratio >= 0.10, (
                f"{leader['name']}: {overlap}/{len(meta_ids)} ({ratio:.0%}) meta overlap (need ≥10%)"
            )


# ── Suite 4: Synergy Coherence ────────────────────────────


class TestSynergyCoherence:
    @pytest.mark.asyncio
    async def test_synergy_density(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        for leader in test_leaders["popular"]:
            result = await get_or_build(driver, leader["id"], "midrange")
            if "error" in result:
                continue
            deck_ids = list({c["id"] for c in result["cards"]})
            syn = await get_deck_synergies(driver, deck_ids)
            edge_count = len(syn.get("edges", []))
            assert edge_count >= 5, (
                f"{leader['name']}: {edge_count} synergy edges among {len(deck_ids)} cards"
            )

    @pytest.mark.asyncio
    async def test_leader_family_coherence(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        leader = test_leaders["popular"][0]
        result = await get_or_build(driver, leader["id"], "midrange")
        if "error" in result:
            pytest.skip(f"Build failed for {leader['id']}")
        deck_ids = list({c["id"] for c in result["cards"]})
        async with driver.session() as session:
            r = await session.run(
                """
                MATCH (c:Card)-[:LED_BY]->(:Card {id: $lid})
                WHERE c.id IN $ids
                RETURN count(c) AS led_count
            """,
                lid=leader["id"],
                ids=deck_ids,
            )
            rec = await r.single()
            led_count = rec["led_count"] if rec else 0
        unique = len(deck_ids)
        ratio = led_count / unique if unique else 0
        assert ratio >= 0.15, (
            f"{led_count}/{unique} ({ratio:.0%}) cards LED_BY leader {leader['name']} (need ≥15%)"
        )


# ── Suite 5: Strategy Differentiation ─────────────────────


class TestStrategyDifferentiation:
    @pytest.mark.asyncio
    async def test_strategies_differ(self, driver, test_leaders):
        if not test_leaders["popular"]:
            pytest.skip("No popular leaders")
        leader = test_leaders["popular"][0]
        builds: dict[str, dict] = {}

        for strategy in ["aggro", "midrange", "control"]:
            result = await get_or_build(driver, leader["id"], strategy)
            if "error" in result:
                pytest.skip(f"Build failed: {leader['id']} ({strategy})")
            cards = result["cards"]
            builds[strategy] = {
                "avg_cost": sum(c.get("cost") or 0 for c in cards) / len(cards),
                "blockers": sum(1 for c in cards if "Blocker" in (c.get("keywords") or [])),
                "rush": sum(1 for c in cards if "Rush" in (c.get("keywords") or [])),
                "events": sum(1 for c in cards if c.get("card_type") == "EVENT"),
                "finishers": sum(
                    1 for c in cards if (c.get("cost") or 0) >= 7 and (c.get("power") or 0) >= 7000
                ),
            }

        # Count meaningful differences
        diffs = 0
        if builds["aggro"]["avg_cost"] < builds["control"]["avg_cost"] - 0.3:
            diffs += 1
        if builds["control"]["blockers"] > builds["aggro"]["blockers"]:
            diffs += 1
        if builds["aggro"]["rush"] > builds["control"]["rush"]:
            diffs += 1
        if builds["control"]["events"] > builds["aggro"]["events"]:
            diffs += 1
        if builds["control"]["finishers"] > builds["aggro"]["finishers"]:
            diffs += 1

        print(f"\n  Strategy builds for {leader['name']}:")
        for s, b in builds.items():
            print(f"    {s}: {b}")
        print(f"  Meaningful diffs: {diffs}/5")

        assert diffs >= 2, f"Only {diffs}/5 strategy differences: {builds}"


# ── Suite 6: Edge Cases ───────────────────────────────────


class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_invalid_leader(self, driver):
        result = await build_deck(driver, "FAKE-999", "midrange")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_non_leader_card(self, driver):
        async with driver.session() as session:
            r = await session.run(
                "MATCH (c:Card {card_type: 'CHARACTER'}) RETURN c.id AS id LIMIT 1"
            )
            rec = await r.single()
        if not rec:
            pytest.skip("No CHARACTER cards")
        result = await build_deck(driver, rec["id"], "midrange")
        assert "error" in result


# ── Suite 7: Playability Report ───────────────────────────


class TestPlayabilityReport:
    @pytest.mark.asyncio
    async def test_playability_scores(self, driver, test_leaders, meta_cards_by_leader):
        lines = [
            "",
            "=" * 130,
            "  DECK BUILDER INTELLIGENCE REPORT",
            "=" * 130,
            f"  {'Leader':<30s} | {'Strategy':<10s} | {'Tier':<12s} | {'Score':>5s} | "
            f"{'Legal':>5s} | {'Qual':>4s} | {'4x':>3s} | {'Syn':>4s} | "
            f"{'Meta':>4s} | {'AvgCtr':>6s} | Warnings",
            "-" * 130,
        ]
        scores: list[float] = []

        all_leaders = (
            [(ldr, "popular") for ldr in test_leaders["popular"]]
            + [(ldr, "mid_tier") for ldr in test_leaders["mid_tier"]]
            + [(ldr, "multi_color") for ldr in test_leaders["multi_color"]]
            + [(ldr, "zero_deck") for ldr in test_leaders["zero_deck"]]
        )

        for leader, tier in all_leaders:
            for strategy in ["aggro", "midrange", "control"]:
                result = await get_or_build(driver, leader["id"], strategy)
                if "error" in result:
                    lines.append(
                        f"  {leader.get('name', leader['id']):<30s} | {strategy:<10s} | "
                        f"{tier:<12s} | {'SKIP':>5s}  | {result['error']}"
                    )
                    continue

                meta_ids = meta_cards_by_leader.get(leader["id"], set())
                deck_ids = list({c["id"] for c in result["cards"]})
                syn = await get_deck_synergies(driver, deck_ids)
                edge_count = len(syn.get("edges", []))

                score = compute_playability(result, meta_ids, edge_count)
                scores.append(score)

                checks = result["validation"]["checks"]
                rule_names = {
                    "DECK_SIZE",
                    "COPY_LIMIT",
                    "COLOR_MATCH",
                    "LEADER_VALID",
                    "NO_LEADER_IN_DECK",
                }
                qp = sum(1 for c in checks if c["status"] == "PASS" and c["name"] not in rule_names)
                warns = [c["name"] for c in checks if c["status"] == "WARNING"]
                four_x = len(result.get("four_copy_cards", []))
                ctrs = [c.get("counter") or 0 for c in result["cards"]]
                avg_ctr = sum(ctrs) / len(ctrs) if ctrs else 0
                mo = len(set(deck_ids) & meta_ids) if meta_ids else 0

                lines.append(
                    f"  {leader.get('name', leader['id']):<30s} | {strategy:<10s} | "
                    f"{tier:<12s} | {score:5.1f} | "
                    f"{'YES' if result['validation']['is_legal'] else 'NO':>5s} | "
                    f"{qp:>3d}/8 | {four_x:>3d} | {edge_count:>4d} | "
                    f"{mo:>4d} | {avg_ctr:>6.0f} | {warns}"
                )

        if scores:
            avg = sum(scores) / len(scores)
            lines.extend(
                [
                    "-" * 130,
                    f"  TOTAL: {len(scores)} decks  |  AVG: {avg:.1f}/100  |  "
                    f"MIN: {min(scores):.1f}  |  MAX: {max(scores):.1f}",
                    "",
                    "  GRADE: "
                    + (
                        "A — Tournament-ready"
                        if avg >= 75
                        else "B — Competitive"
                        if avg >= 60
                        else "C — Playable, needs tuning"
                        if avg >= 50
                        else "D — Below standard"
                    ),
                    "=" * 130,
                ]
            )
        else:
            lines.append("  NO DECKS BUILT — check Neo4j data")

        print("\n".join(lines))

        if scores:
            assert sum(scores) / len(scores) >= 40, f"Avg playability {avg:.1f} < 40"
