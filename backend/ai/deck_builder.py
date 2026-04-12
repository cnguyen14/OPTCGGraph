"""OPTCG Deck Building Engine — builds legal, competitive decks for any leader.

Two-step pipeline:
  Step 1 (Build): Algorithmic deck assembly using graph synergy + meta stats
  Step 2 (QC Review): LLM reviews card choices, ability synergies, and strategy coherence.
         If issues found, swaps are applied from the candidate pool.

Rules enforced:
- Exactly 50 cards (not counting Leader)
- Max 4 copies of any card
- All cards match Leader's color(s)
- No LEADER cards in deck

Quality targets based on pro tournament data:
- Balanced cost curve by strategy (aggro/midrange/control)
- Sufficient counter density (avg 800+ per card)
- Role coverage: blockers, removal, draw/search, finishers
- Character-heavy composition (~77%)
"""

import asyncio
import copy
import json
import logging
import re
from collections import Counter

from neo4j import AsyncDriver

from backend.ai.deck_validator import validate_deck
from backend.graph.queries import get_card_by_id
from backend.services.llm_service import (
    LLMNotAvailableError,
    has_any_llm_key,
    llm_complete,
    strip_json_fences,
)

logger = logging.getLogger(__name__)

# Strategy templates: target card counts per role/cost
STRATEGY_TEMPLATES = {
    "aggro": {
        "cost_targets": {
            (0, 2): (14, 18),
            (3, 5): (18, 22),
            (6, 9): (8, 10),
            (10, 99): (0, 2),
        },
        "role_targets": {
            "blockers": 4,
            "removal": 4,
            "draw": 2,
            "searcher": 2,
            "rush": 6,
            "finishers": 2,
        },
        "type_targets": {"CHARACTER": (38, 42), "EVENT": (6, 10), "STAGE": (0, 2)},
    },
    "midrange": {
        "cost_targets": {
            (0, 2): (10, 14),
            (3, 5): (18, 22),
            (6, 9): (10, 14),
            (10, 99): (0, 2),
        },
        "role_targets": {
            "blockers": 6,
            "removal": 6,
            "draw": 3,
            "searcher": 3,
            "rush": 4,
            "finishers": 4,
        },
        "type_targets": {"CHARACTER": (36, 40), "EVENT": (8, 12), "STAGE": (0, 4)},
    },
    "control": {
        "cost_targets": {
            (0, 2): (8, 10),
            (3, 5): (16, 20),
            (6, 9): (14, 18),
            (10, 99): (2, 4),
        },
        "role_targets": {
            "blockers": 8,
            "removal": 8,
            "draw": 4,
            "searcher": 4,
            "rush": 2,
            "finishers": 6,
        },
        "type_targets": {"CHARACTER": (32, 38), "EVENT": (10, 16), "STAGE": (2, 4)},
    },
}

ROLE_KEYWORDS = {
    "blockers": ["Blocker"],
    "removal": ["KO", "Bounce", "Trash", "Power Debuff", "Rest"],
    "draw": ["Draw"],
    "searcher": ["Search"],
    "rush": ["Rush"],
}


def _apply_playstyle_hints(template: dict, hints: str) -> dict:
    """Adjust strategy template based on playstyle hints."""
    if not hints:
        return template
    t = copy.deepcopy(template)
    hint_set = {h.strip().lower() for h in hints.split(",") if h.strip()}

    if "rush" in hint_set:
        t["role_targets"]["rush"] = max(t["role_targets"].get("rush", 0), 8)
    if "low_curve" in hint_set or "fast_damage" in hint_set:
        t["cost_targets"][(0, 2)] = (16, 20)
        t["cost_targets"][(3, 5)] = (20, 24)
        t["cost_targets"][(6, 9)] = (4, 8)
    if "wide_board" in hint_set:
        t["cost_targets"][(0, 2)] = (16, 20)
        t["type_targets"]["CHARACTER"] = (40, 44)
    if "card_advantage" in hint_set or "value" in hint_set:
        t["role_targets"]["draw"] = max(t["role_targets"].get("draw", 0), 5)
        t["role_targets"]["searcher"] = max(t["role_targets"].get("searcher", 0), 5)
    if "defensive" in hint_set or "blockers" in hint_set:
        t["role_targets"]["blockers"] = max(t["role_targets"].get("blockers", 0), 10)
    if "removal_heavy" in hint_set:
        t["role_targets"]["removal"] = max(t["role_targets"].get("removal", 0), 10)
    if "big_finishers" in hint_set:
        t["cost_targets"][(6, 9)] = (14, 18)
        t["role_targets"]["finishers"] = max(t["role_targets"].get("finishers", 0), 6)

    return t


async def build_deck(
    driver: AsyncDriver,
    leader_id: str,
    strategy: str = "midrange",
    playstyle_hints: str = "",
    signature_cards: list[str] | None = None,
    budget_max: float | None = None,
    existing_card_ids: list[str] | None = None,
) -> dict:
    """Build a legal, competitive deck for any leader.

    Returns dict with: leader, cards (list of 50), validation, curve, summary.
    """
    # 1. Resolve leader
    leader = await get_card_by_id(driver, leader_id)
    if leader is None:
        return {"error": f"Leader {leader_id} not found"}
    if leader.get("card_type") != "LEADER":
        return {"error": f"{leader_id} is not a LEADER card"}

    leader_colors = set(leader.get("colors", []))
    if not leader_colors:
        return {"error": f"Leader {leader_id} has no colors"}

    strategy = strategy if strategy in STRATEGY_TEMPLATES else "midrange"
    template = _apply_playstyle_hints(STRATEGY_TEMPLATES[strategy], playstyle_hints)

    # Apply color-specific role adjustments
    from backend.ai.game_rules import COLOR_STRATEGIES

    for color in leader_colors:
        color_strat = COLOR_STRATEGIES.get(color, {})
        for role, multiplier in color_strat.get("preferred_roles", {}).items():
            if role in template["role_targets"]:
                original = template["role_targets"][role]
                template["role_targets"][role] = min(
                    round(original * multiplier),
                    original * 2,  # Cap at 2x to prevent extreme stacking
                )

    # Adjust STAGE targets based on tournament data for this leader
    stage_usage = await _analyze_leader_stage_usage(driver, leader_id)
    if stage_usage["avg_stage_count"] > 0:
        # Tournament decks use stages with this leader — expand stage targets
        target_stages = max(2, round(stage_usage["avg_stage_count"]))
        current_min, current_max = template["type_targets"].get("STAGE", (0, 2))
        template["type_targets"]["STAGE"] = (
            min(target_stages, current_max),
            max(target_stages + 2, current_max),
        )
        logger.info(
            f"Stage adjustment for {leader_id}: tournament avg {stage_usage['avg_stage_count']:.1f} "
            f"→ target {template['type_targets']['STAGE']}"
        )

    # 2. Get candidates via parallel queries (synergy + curve scores + counter pool)
    candidates = await _get_candidates_parallel(driver, leader_id, leader_colors)
    if not candidates:
        return {"error": f"No eligible cards found for leader {leader_id} colors {leader_colors}"}

    logger.info(
        f"Found {len(candidates)} candidates for {leader_id} ({strategy}, hints={playstyle_hints})"
    )

    # 3. Categorize candidates by role
    categorized = _categorize(candidates)

    # 4. Build deck using strategy template
    deck = _fill_deck(
        candidates, categorized, template, budget_max, signature_cards, existing_card_ids
    )

    # 5. Validate and self-correct
    report = validate_deck(leader, deck)
    if not report.is_legal:
        logger.warning("Deck failed validation, attempting self-correction...")
        deck = _fix_violations(deck, report, candidates, leader_colors)
        report = validate_deck(leader, deck)

    # 6. QC Review — LLM reviews card choices + ability synergy
    qc_review_result: dict = {"verdict": "SKIP", "reasoning": "QC not run"}
    try:
        deck, qc_review_result = await _qc_review(
            leader, deck, candidates, strategy, report, playstyle_hints
        )
        if qc_review_result.get("swaps_applied", 0) > 0:
            # Re-validate after QC swaps
            report = validate_deck(leader, deck)
            logger.info(f"Post-QC validation: legal={report.is_legal}")
    except Exception as e:
        logger.warning(f"QC review failed (non-fatal): {e}")
        qc_review_result = {"verdict": "SKIP", "reasoning": f"Error: {e}"}

    # 6b. Evaluate existing cards for potential swaps
    existing_swaps: list[dict] = []
    if existing_card_ids:
        existing_swaps = _evaluate_existing_cards(existing_card_ids, deck, candidates)

    # 7. Build summary
    curve = Counter(c.get("cost", 0) for c in deck if c.get("cost") is not None)
    type_counts = Counter(c.get("card_type", "") for c in deck)
    id_counts = Counter(c["id"] for c in deck)
    total_price = sum(c.get("market_price") or 0 for c in deck)

    return {
        "leader": {
            "id": leader["id"],
            "name": leader["name"],
            "colors": leader.get("colors", []),
            "families": leader.get("families", []),
            "ability": leader.get("ability", ""),
        },
        "cards": [
            {
                "id": c["id"],
                "name": c.get("name", ""),
                "cost": c.get("cost"),
                "power": c.get("power"),
                "counter": c.get("counter"),
                "card_type": c.get("card_type", ""),
                "keywords": c.get("keywords", []),
                "market_price": c.get("market_price"),
                "tournament_pick_rate": c.get("tournament_pick_rate"),
                "top_cut_rate": c.get("top_cut_rate"),
            }
            for c in deck
        ],
        "total_cards": len(deck),
        "total_price": round(total_price, 2),
        "strategy": strategy,
        "playstyle_hints": playstyle_hints,
        "curve": dict(sorted(curve.items())),
        "type_distribution": dict(type_counts),
        "unique_cards": len(id_counts),
        "four_copy_cards": [cid for cid, cnt in id_counts.items() if cnt == 4],
        "validation": report.to_dict(),
        "qc_review": qc_review_result,
        "existing_card_swaps": existing_swaps,
    }


async def _analyze_leader_stage_usage(driver: AsyncDriver, leader_id: str) -> dict:
    """Query tournament decks to determine how many stage cards this leader typically uses.

    Returns dict with avg_stage_count and top_stages (list of {id, name, avg_copies}).
    This lets the builder dynamically adjust STAGE targets based on real data
    instead of hardcoded templates.
    """
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(:Card {id: $leader_id})
            MATCH (d)-[inc:INCLUDES]->(c:Card {card_type: 'STAGE'})
            WITH d, sum(inc.count) AS stage_count
            WITH avg(stage_count) AS avg_stages, collect(stage_count) AS counts
            RETURN avg_stages, size(counts) AS decks_with_stages
            """,
            leader_id=leader_id,
        )
        rec = await result.single()
        avg_stages = rec["avg_stages"] if rec and rec["avg_stages"] else 0
        decks_with = rec["decks_with_stages"] if rec else 0

        # Also get specific popular stages for this leader
        result2 = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(:Card {id: $leader_id})
            MATCH (d)-[inc:INCLUDES]->(c:Card {card_type: 'STAGE'})
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            ORDER BY deck_count DESC
            LIMIT 5
            RETURN c.id AS id, c.name AS name,
                   deck_count, round(avg_copies * 100) / 100 AS avg_copies
            """,
            leader_id=leader_id,
        )
        top_stages = [
            {
                "id": r["id"],
                "name": r["name"],
                "deck_count": r["deck_count"],
                "avg_copies": r["avg_copies"],
            }
            async for r in result2
        ]

        # If no tournament data, fallback: find stages connected via LED_BY graph edge
        if not top_stages:
            result3 = await session.run(
                """
                MATCH (s:Card {card_type: 'STAGE'})-[:LED_BY]->(:Card {id: $leader_id})
                OPTIONAL MATCH (s)-[:HAS_KEYWORD]->(k:Keyword)
                WITH s, collect(DISTINCT k.name) AS keywords
                WHERE size(keywords) > 0
                RETURN s.id AS id, s.name AS name, size(keywords) AS kw_count
                ORDER BY kw_count DESC
                LIMIT 5
                """,
                leader_id=leader_id,
            )
            # Deduplicate parallel arts (e.g. OP08-056 and OP08-056_p1 are same card)
            seen_bases: set[str] = set()
            graph_stages = []
            async for r in result3:
                base = _base_card_id(r["id"])
                if base not in seen_bases:
                    seen_bases.add(base)
                    graph_stages.append(
                        {"id": r["id"], "name": r["name"], "deck_count": 0, "avg_copies": 2.0}
                    )
            if graph_stages:
                top_stages = graph_stages
                # Conservative estimate: graph suggests stages exist but no tournament proof
                # Use 1 copy per stage (not 2) to avoid over-allocating
                avg_stages = len(graph_stages) * 1.0
                logger.info(
                    f"No tournament stage data for {leader_id}, "
                    f"graph fallback found {len(graph_stages)} stages via LED_BY"
                )

    return {
        "avg_stage_count": float(avg_stages),
        "decks_with_stages": decks_with,
        "top_stages": top_stages,
    }


async def _get_candidates(
    driver: AsyncDriver, leader_id: str, leader_colors: set[str]
) -> list[dict]:
    """Get all eligible cards: matching leader colors, non-LEADER, with synergy scoring."""
    color_list = list(leader_colors)

    async with driver.session() as session:
        # Get cards matching any of the leader's colors + not LEADER type
        # Score by: LED_BY, SYNERGY (family), MECHANICAL_SYNERGY (keyword) connections
        result = await session.run(
            """
            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
            WHERE color.name IN $colors
              AND c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
              AND (c.banned IS NULL OR c.banned = false)
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            OPTIONAL MATCH (c)-[led:LED_BY]->(:Card {id: $leader_id})
            OPTIONAL MATCH (c)-[syn:SYNERGY]-(:Card)-[:LED_BY]->(:Card {id: $leader_id})
            OPTIONAL MATCH (c)-[msyn:MECHANICAL_SYNERGY]-(:Card)-[:LED_BY]->(:Card {id: $leader_id})
            OPTIONAL MATCH (c)-[dsyn:SYNERGY]-(:Card {id: $leader_id})
            OPTIONAL MATCH (c)-[dmsyn:MECHANICAL_SYNERGY]-(:Card {id: $leader_id})
            WITH c,
                 collect(DISTINCT k.name) AS keywords,
                 collect(DISTINCT color.name) AS colors,
                 CASE WHEN led IS NOT NULL THEN 3 ELSE 0 END AS led_score,
                 CASE WHEN syn IS NOT NULL THEN 1.5 ELSE 0 END AS syn_score,
                 CASE WHEN msyn IS NOT NULL THEN 1.0 ELSE 0 END AS msyn_score,
                 CASE WHEN dsyn IS NOT NULL THEN 2.0 ELSE 0 END AS direct_syn,
                 CASE WHEN dmsyn IS NOT NULL THEN 1.0 ELSE 0 END AS direct_msyn
            RETURN c, keywords, colors,
                   (led_score + syn_score + msyn_score + direct_syn + direct_msyn) AS relevance,
                   c.tournament_pick_rate AS tournament_pick_rate,
                   c.top_cut_rate AS top_cut_rate,
                   c.avg_copies AS avg_copies
            ORDER BY relevance DESC, c.cost ASC
            """,
            colors=color_list,
            leader_id=leader_id,
        )

        candidates = []
        seen = set()
        async for record in result:
            card = dict(record["c"])
            card["keywords"] = record["keywords"]
            card["colors"] = record["colors"]
            card["relevance"] = record["relevance"]
            card["tournament_pick_rate"] = record["tournament_pick_rate"]
            card["top_cut_rate"] = record["top_cut_rate"]
            card["avg_copies"] = record["avg_copies"]
            if card["id"] not in seen:
                candidates.append(card)
                seen.add(card["id"])

    return candidates


async def _get_curve_scores(
    driver: AsyncDriver, leader_id: str, leader_colors: set[str]
) -> dict[str, float]:
    """Get CURVES_INTO scores in a separate lightweight query.

    Returns a dict of card_id -> curve_score (1.0 if card curves into
    a card associated with the leader, 0.0 otherwise).
    Kept separate from main query to avoid OPTIONAL MATCH memory explosion.
    """
    color_list = list(leader_colors)
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
            WHERE color.name IN $colors
              AND c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
            WITH DISTINCT c
            MATCH (c)-[:CURVES_INTO]-(other:Card)-[:LED_BY]->(:Card {id: $leader_id})
            RETURN DISTINCT c.id AS card_id
            """,
            colors=color_list,
            leader_id=leader_id,
        )
        return {record["card_id"]: 1.0 async for record in result}


async def _get_counter_pool(driver: AsyncDriver, leader_colors: set[str]) -> list[dict]:
    """Get high-counter cards that may be missed by synergy scoring."""
    color_list = list(leader_colors)
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
            WHERE color.name IN $colors
              AND c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
              AND (c.banned IS NULL OR c.banned = false)
              AND c.counter >= 2000
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            RETURN c, collect(DISTINCT k.name) AS keywords,
                   collect(DISTINCT color.name) AS colors,
                   0 AS relevance,
                   c.tournament_pick_rate AS tournament_pick_rate,
                   c.top_cut_rate AS top_cut_rate,
                   c.avg_copies AS avg_copies
            ORDER BY c.counter DESC
            LIMIT 30
            """,
            colors=color_list,
        )
        cards = []
        async for record in result:
            card = dict(record["c"])
            card["keywords"] = record["keywords"]
            card["colors"] = record["colors"]
            card["relevance"] = record["relevance"]
            card["tournament_pick_rate"] = record["tournament_pick_rate"]
            card["top_cut_rate"] = record["top_cut_rate"]
            card["avg_copies"] = record["avg_copies"]
            cards.append(card)
        return cards


async def _get_candidates_parallel(
    driver: AsyncDriver, leader_id: str, leader_colors: set[str]
) -> list[dict]:
    """Get candidates via 3 parallel queries, then merge.

    Runs simultaneously:
    1. Main synergy-scored candidates (LED_BY, SYNERGY, MECHANICAL_SYNERGY)
    2. CURVES_INTO scores (lightweight, separate to avoid memory explosion)
    3. High-counter pool (ensures +2000 counter cards are well-represented)

    Merges curve scores into candidates, adds missing counter cards.
    """
    # Run 3 independent queries in parallel
    main_candidates, curve_scores, counter_pool = await asyncio.gather(
        _get_candidates(driver, leader_id, leader_colors),
        _get_curve_scores(driver, leader_id, leader_colors),
        _get_counter_pool(driver, leader_colors),
    )

    # Merge curve scores into main candidates
    for card in main_candidates:
        card["relevance"] += curve_scores.get(card["id"], 0.0)

    # Add counter pool cards not already in candidates
    existing_ids = {c["id"] for c in main_candidates}
    for card in counter_pool:
        if card["id"] not in existing_ids:
            main_candidates.append(card)
            existing_ids.add(card["id"])

    # Re-sort by updated relevance
    main_candidates.sort(key=lambda c: (-c.get("relevance", 0), c.get("cost") or 0))

    logger.info(
        f"Parallel search: {len(main_candidates)} candidates "
        f"({len(curve_scores)} with curve bonus, {len(counter_pool)} counter pool)"
    )
    return main_candidates


def _categorize(candidates: list[dict]) -> dict[str, list[dict]]:
    """Categorize candidates by gameplay role based on keywords and stats."""
    buckets: dict[str, list[dict]] = {
        "blockers": [],
        "removal": [],
        "draw": [],
        "searcher": [],
        "rush": [],
        "finishers": [],
        "counter_cards": [],
        "characters": [],
        "events": [],
        "stages": [],
    }

    for card in candidates:
        keywords = set(card.get("keywords", []))
        card_type = card.get("card_type", "")
        cost = card.get("cost") or 0
        power = card.get("power") or 0
        counter = card.get("counter") or 0

        # Type buckets
        if card_type == "CHARACTER":
            buckets["characters"].append(card)
        elif card_type == "EVENT":
            buckets["events"].append(card)
        elif card_type == "STAGE":
            buckets["stages"].append(card)

        # Role buckets (a card can be in multiple)
        for role, kws in ROLE_KEYWORDS.items():
            if keywords & set(kws):
                buckets[role].append(card)

        if cost >= 7 and power >= 7000:
            buckets["finishers"].append(card)

        if counter >= 1000:
            buckets["counter_cards"].append(card)

    return buckets


_PARALLEL_ART_RE = re.compile(r"(_p\d+|_r\d+)$")


def _base_card_id(card_id: str) -> str:
    """Get base card number by stripping parallel art suffixes (_p1, _p2, _r1, etc.).

    In OPTCG, parallel art cards (e.g. OP03-018_p1) are the same card as the base
    (OP03-018) and share the 4-copy tournament limit.
    """
    return _PARALLEL_ART_RE.sub("", card_id)


def _score_card(card: dict) -> float:
    """Score a card for selection: synergy-first, tournament as tiebreaker."""
    relevance = card.get("relevance", 0)
    score = relevance * 3.0  # Synergy dominates (was 2.0)

    # Penalize cards with zero synergy connections — they don't fit the deck network
    if relevance == 0:
        score -= 2.0

    counter = card.get("counter") or 0
    if counter >= 2000:
        score += 3.0  # +2000 counters are premium defensive assets
    elif counter >= 1000:
        score += 1.5
    keywords = set(card.get("keywords", []))
    roles_covered = sum(1 for kws in ROLE_KEYWORDS.values() if keywords & set(kws))
    score += roles_covered * 0.5
    # Event/Stage cards with abilities are valuable even without power/counter
    ability = card.get("ability") or ""
    card_type = card.get("card_type", "")
    if card_type in ("EVENT", "STAGE") and ability:
        score += 1.0
        # Events with Trigger effects get bonus (free value when life is hit)
        if "Trigger" in keywords:
            score += 1.5
    # Stages are persistent (stay on field every turn) — extra value over one-shot events
    if card_type == "STAGE" and ability:
        score += 2.0
    # Tournament meta stats — tiebreaker, not primary driver (weights reduced)
    pick_rate = card.get("tournament_pick_rate") or 0
    top_cut_rate = card.get("top_cut_rate") or 0
    avg_copies = card.get("avg_copies") or 0
    score += pick_rate * 1.0 + top_cut_rate * 1.5 + avg_copies * 0.3
    # Parallel art penalty: same gameplay but higher price — prefer base art
    if _PARALLEL_ART_RE.search(card.get("id", "")):
        score -= 0.5
    return score


def _evaluate_existing_cards(
    existing_ids: list[str],
    deck: list[dict],
    candidates: list[dict],
) -> list[dict]:
    """Evaluate existing cards and suggest swaps for weak ones."""
    candidate_map = {c["id"]: c for c in candidates}
    deck_ids = {c["id"] for c in deck}
    swaps = []

    for card_id in set(existing_ids):
        card = candidate_map.get(card_id)
        if not card:
            continue
        card_score = _score_card(card)
        cost = card.get("cost") or 0

        # Find better alternatives at similar cost (±1), same card type
        alternatives = [
            c
            for c in candidates
            if c["id"] not in deck_ids
            and c["id"] != card_id
            and abs((c.get("cost") or 0) - cost) <= 1
            and c.get("card_type") == card.get("card_type")
        ]
        alternatives.sort(key=lambda c: -_score_card(c))

        if alternatives and _score_card(alternatives[0]) > card_score * 1.3:
            best = alternatives[0]
            swaps.append(
                {
                    "remove_id": card_id,
                    "remove_name": card.get("name", ""),
                    "add_id": best["id"],
                    "add_name": best.get("name", ""),
                    "reason": "Better synergy and tournament performance at similar cost",
                    "remove_score": round(card_score, 1),
                    "add_score": round(_score_card(best), 1),
                }
            )

    return swaps[:5]


def _fill_deck(
    candidates: list[dict],
    categorized: dict[str, list[dict]],
    template: dict,
    budget_max: float | None,
    signature_cards: list[str] | None = None,
    existing_card_ids: list[str] | None = None,
) -> list[dict]:
    """Fill a 50-card deck with type diversity, 4x core consistency, balanced curve, and counter density."""
    deck: list[dict] = []
    deck_ids: Counter = Counter()  # Count by exact card ID
    base_ids: Counter = Counter()  # Count by base card number (parallel art aware)
    total_price = 0.0
    type_targets = template.get("type_targets", {})

    def can_add(card: dict) -> bool:
        if deck_ids[card["id"]] >= 4:
            return False
        # Parallel art check: OP03-018 + OP03-018_p1 share the 4-copy limit
        if base_ids[_base_card_id(card["id"])] >= 4:
            return False
        if card.get("card_type") == "LEADER":
            return False
        if budget_max:
            price = card.get("market_price") or 0
            if total_price + price > budget_max:
                return False
        return True

    def add_card(card: dict, copies: int = 1) -> int:
        nonlocal total_price
        added = 0
        for _ in range(copies):
            if len(deck) >= 50 or not can_add(card):
                break
            deck.append(card)
            deck_ids[card["id"]] += 1
            base_ids[_base_card_id(card["id"])] += 1
            total_price += card.get("market_price") or 0
            added += 1
        return added

    def type_count(card_type: str) -> int:
        return sum(1 for c in deck if c.get("card_type") == card_type)

    cost_targets = template["cost_targets"]
    candidate_map = {c["id"]: c for c in candidates}

    # === Phase -2: Lock in existing cards from user's deck ===
    if existing_card_ids:
        existing_counts: Counter = Counter(existing_card_ids)
        for card_id, qty in existing_counts.items():
            card = candidate_map.get(card_id)
            if card and card.get("card_type") != "LEADER":
                add_card(card, copies=min(qty, 4))

    # === Phase -1: Lock in signature cards (only if they have synergy) ===
    if signature_cards:
        for card_id in signature_cards:
            card = candidate_map.get(card_id)
            if card and can_add(card):
                # Only lock signature cards that actually connect to the deck's
                # synergy network. Skip cards with 0 relevance — tournament
                # popularity alone doesn't guarantee fit for this specific deck.
                relevance = card.get("relevance", 0)
                if relevance <= 0:
                    logger.info(
                        "Skipping signature card %s (relevance=%.1f, no synergy)",
                        card_id,
                        relevance,
                    )
                    continue
                avg = card.get("avg_copies") or 4
                copies = max(2, min(4, round(avg)))
                add_card(card, copies=copies)

    # === Phase 0: Select CORE CHARACTER cards (4x copies each) ===
    # Reserve slots for Events/Stages — only fill CHARACTER portion of core
    char_min, char_max = type_targets.get("CHARACTER", (36, 42))
    char_core_sets = max(1, char_min // 4)  # How many 4x character playsets

    # Distribute character core sets across cost tiers proportionally
    tier_weights = {tier: tmin for tier, (tmin, _) in cost_targets.items()}
    total_weight = sum(tier_weights.values()) or 1
    char_sets_remaining = char_core_sets

    for (cost_min, cost_max), (target_min, _target_max) in cost_targets.items():
        # Proportional share of character core for this tier
        tier_share = max(1, round(char_core_sets * target_min / total_weight))
        tier_share = min(tier_share, char_sets_remaining)

        pool = [
            c
            for c in candidates
            if cost_min <= (c.get("cost") or 0) <= cost_max and c.get("card_type") == "CHARACTER"
        ]
        pool.sort(key=lambda c: -_score_card(c))

        selected = 0
        for card in pool:
            if selected >= tier_share or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0:
                added = add_card(card, copies=4)
                if added > 0:
                    selected += 1
                    char_sets_remaining -= 1

    # === Phase 1: Fill EVENT quota ===
    # Events provide removal, triggers, and combo effects — essential for competitive play
    event_min, event_max = type_targets.get("EVENT", (6, 10))
    event_target = (event_min + event_max) // 2  # Aim for midpoint
    events_needed = max(0, event_target - type_count("EVENT"))

    if events_needed > 0:
        event_pool = sorted(categorized.get("events", []), key=lambda c: -_score_card(c))
        for card in event_pool:
            if events_needed <= 0 or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0 and can_add(card):
                # Events with Trigger keyword or role keywords get 4x, others 2x
                keywords = set(card.get("keywords", []))
                has_role = any(keywords & set(kws) for kws in ROLE_KEYWORDS.values())
                copies = 4 if (has_role or "Trigger" in keywords) else 2
                added = add_card(card, copies=min(copies, events_needed))
                events_needed -= added

    # === Phase 2: Fill STAGE quota ===
    # Stages are persistent (stay on field) — use tournament avg_copies for copy count
    stage_min, stage_max = type_targets.get("STAGE", (0, 2))
    stage_target = max(stage_min, (stage_min + stage_max) // 2)
    stages_needed = max(0, stage_target - type_count("STAGE"))

    if stages_needed > 0:
        stage_pool = sorted(categorized.get("stages", []), key=lambda c: -_score_card(c))
        for card in stage_pool:
            if stages_needed <= 0 or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0 and can_add(card):
                avg = card.get("avg_copies") or 0
                # High tournament usage → use avg_copies, otherwise 2
                copies = max(2, min(4, round(avg))) if avg >= 2 else 2
                added = add_card(card, copies=min(copies, stages_needed))
                stages_needed -= added

    # === Phase 3: Fill ROLE gaps ===
    # Check which roles are under-target after core + type fill, add specialists
    role_targets = template["role_targets"]
    for role, target_count in role_targets.items():
        current_role = sum(
            1 for c in deck if set(c.get("keywords", [])) & set(ROLE_KEYWORDS.get(role, []))
        )
        if current_role >= target_count:
            continue

        needed = target_count - current_role
        pool = sorted(categorized.get(role, []), key=lambda c: -_score_card(c))
        for card in pool:
            if needed <= 0 or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0:
                added = add_card(card, copies=min(2, needed))
                needed -= added

    # === Phase 4: Fill COST CURVE gaps ===
    for (cost_min, cost_max), (target_min, _target_max) in cost_targets.items():
        current = sum(1 for c in deck if cost_min <= (c.get("cost") or 0) <= cost_max)
        if current >= target_min:
            continue
        needed = target_min - current
        pool = [
            c
            for c in candidates
            if cost_min <= (c.get("cost") or 0) <= cost_max and c.get("card_type") != "LEADER"
        ]
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -_score_card(c)))
        for card in pool:
            if needed <= 0 or len(deck) >= 50:
                break
            if can_add(card):
                added = add_card(card, copies=min(2, needed))
                needed -= added

    # === Phase 5: Fill remaining with counter-dense cards ===
    if len(deck) < 50:
        pool = [c for c in candidates if can_add(c) and (c.get("counter") or 0) >= 1000]
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -_score_card(c)))
        for card in pool:
            if len(deck) >= 50:
                break
            add_card(card)

    # === Phase 6: Pad to 50 with extra copies of best cards ===
    if len(deck) < 50:
        existing = sorted(
            set(c["id"] for c in deck),
            key=lambda cid: -max(_score_card(c) for c in deck if c["id"] == cid),
        )
        for cid in existing:
            if len(deck) >= 50:
                break
            card = next(c for c in deck if c["id"] == cid)
            while len(deck) < 50 and deck_ids[cid] < 4:
                add_card(card)

    # === Phase 7: Last resort — any valid candidate ===
    if len(deck) < 50:
        for card in candidates:
            if len(deck) >= 50:
                break
            if can_add(card):
                add_card(card)

    return deck[:50]


def _fix_violations(
    deck: list[dict],
    report,
    candidates: list[dict],
    leader_colors: set[str],
) -> list[dict]:
    """Fix rule violations by swapping illegal cards with valid alternatives."""
    fixed = list(deck)

    # Fix: remove LEADER cards
    fixed = [c for c in fixed if c.get("card_type") != "LEADER"]

    # Fix: remove banned cards
    fixed = [c for c in fixed if not c.get("banned")]

    # Fix: remove wrong-color cards
    fixed = [c for c in fixed if set(c.get("colors", [])) & leader_colors]

    # Fix: enforce max 4 copies (parallel art aware)
    final = []
    copy_count: Counter = Counter()
    base_count: Counter = Counter()
    for card in fixed:
        base = _base_card_id(card["id"])
        if copy_count[card["id"]] < 4 and base_count[base] < 4:
            final.append(card)
            copy_count[card["id"]] += 1
            base_count[base] += 1
    fixed = final

    # Pad back to 50 from candidates
    if len(fixed) < 50:
        used = Counter(c["id"] for c in fixed)
        pool = [
            c
            for c in candidates
            if c.get("card_type") != "LEADER"
            and set(c.get("colors", [])) & leader_colors
            and used[c["id"]] < 4
        ]
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -c.get("relevance", 0)))
        for card in pool:
            if len(fixed) >= 50:
                break
            if used[card["id"]] < 4:
                fixed.append(card)
                used[card["id"]] += 1

    return fixed[:50]


# ── Step 2: QC Review Agent ──────────────────────────────

QC_REVIEW_PROMPT = """\
You are an expert OPTCG deck reviewer (QC Agent). Your job is to review a deck built by an automated system \
and identify cards that are weak, off-strategy, or have poor synergy with the rest of the deck.

## Leader
{leader_name} ({leader_id}) — Colors: {leader_colors}, Families: {leader_families}
Ability: {leader_ability}
Strategy: {strategy}
{playstyle_context}

## Current Deck ({total_cards} cards)
{deck_summary}

## Validation Report
{validation_summary}

## Available Replacement Candidates (not in deck, sorted by tournament performance)
{replacement_pool}

## Color-Specific Evaluation
{color_guidance}

## Your Task
Analyze EACH card's ability text and how it synergizes with the leader and other cards.
Look for:
1. Cards whose abilities do NOT support the {strategy} strategy
2. Cards with zero synergy with the leader's family/ability
3. Cards with low tournament pick rate that could be replaced by proven alternatives
4. Missing key roles for this strategy (blockers, removal, rush, draw, finishers)
5. Cards that are redundant (too many of the same role)

## Response Format
Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "verdict": "PASS" or "NEEDS_FIXES",
  "reasoning": "Brief 2-3 sentence overall assessment",
  "swaps": [
    {{
      "remove_id": "CARD-ID to remove",
      "remove_reason": "Why this card is weak",
      "add_id": "CARD-ID to add",
      "add_reason": "Why this replacement is better"
    }}
  ]
}}

Rules:
- Maximum 8 swaps (don't over-optimize, the base build is decent)
- Only swap if the replacement is CLEARLY better, not marginally
- Each swap must maintain: correct colors, max 4 copies, deck stays at 50 cards
- If the deck is already strong, return "PASS" with empty swaps
- Prefer cards with higher tournament_pick_rate and top_cut_rate
- Prioritize ability synergy with the leader over raw stats
"""


def _build_deck_summary(leader: dict, deck: list[dict]) -> str:
    """Build a readable deck summary with abilities for QC review."""
    id_counts = Counter(c["id"] for c in deck)
    unique_cards = {}
    for c in deck:
        if c["id"] not in unique_cards:
            unique_cards[c["id"]] = c

    lines = []
    # Group by cost
    by_cost: dict[int, list[str]] = {}
    for cid, card in unique_cards.items():
        cost = card.get("cost") or 0
        qty = id_counts[cid]
        ability = card.get("ability") or "No ability"
        # Truncate long abilities
        if len(ability) > 120:
            ability = ability[:120] + "..."
        keywords = ", ".join(card.get("keywords", [])) or "none"
        counter = card.get("counter") or 0
        power = card.get("power") or 0
        pick_rate = card.get("tournament_pick_rate") or 0
        top_cut = card.get("top_cut_rate") or 0

        line = (
            f"  {qty}x {card.get('name', '')} ({cid}) — "
            f"{card.get('card_type', '')} Cost:{cost} Power:{power} Counter:{counter} "
            f"Keywords:[{keywords}] Pick:{pick_rate:.0%} TopCut:{top_cut:.0%}\n"
            f"     Ability: {ability}"
        )
        by_cost.setdefault(cost, []).append(line)

    for cost in sorted(by_cost):
        lines.append(f"\n--- Cost {cost} ---")
        lines.extend(by_cost[cost])

    return "\n".join(lines)


def _build_replacement_pool(candidates: list[dict], deck_ids: set[str], limit: int = 30) -> str:
    """Build list of top candidates NOT in the deck for QC to choose from."""
    pool = [c for c in candidates if c["id"] not in deck_ids]
    # Sort by tournament performance
    pool.sort(
        key=lambda c: (
            -(c.get("top_cut_rate") or 0),
            -(c.get("tournament_pick_rate") or 0),
            -_score_card(c),
        )
    )

    lines = []
    for c in pool[:limit]:
        ability = (c.get("ability") or "No ability")[:100]
        keywords = ", ".join(c.get("keywords", [])) or "none"
        pick = c.get("tournament_pick_rate") or 0
        top_cut = c.get("top_cut_rate") or 0
        lines.append(
            f"  {c['id']} — {c.get('name', '')} ({c.get('card_type', '')}) "
            f"Cost:{c.get('cost') or 0} Power:{c.get('power') or 0} Counter:{c.get('counter') or 0} "
            f"Keywords:[{keywords}] Pick:{pick:.0%} "
            f"TopCut:{top_cut:.0%}\n"
            f"     Ability: {ability}"
        )

    return "\n".join(lines) if lines else "No additional candidates available"


async def _qc_review(
    leader: dict,
    deck: list[dict],
    candidates: list[dict],
    strategy: str,
    validation_report,
    playstyle_hints: str = "",
) -> tuple[list[dict], dict]:
    """QC Agent: LLM reviews the deck and suggests swaps.

    Returns (possibly_modified_deck, review_result).
    review_result contains verdict, reasoning, and any swaps applied.
    """
    if not has_any_llm_key():
        logger.warning("No LLM API key — skipping QC review")
        return deck, {
            "verdict": "SKIP",
            "reasoning": "No LLM API key configured. Set one in Settings > BYOK.",
        }

    deck_ids = {c["id"] for c in deck}

    # Build playstyle context for QC prompt
    playstyle_context = ""
    if playstyle_hints:
        playstyle_context = f"\nPlaystyle Preferences: {playstyle_hints}\nEvaluate cards specifically against these playstyle goals.\n"

    # Build color-specific guidance
    from backend.ai.game_rules import COLOR_STRATEGIES

    color_lines = []
    for color in leader.get("colors", []):
        cs = COLOR_STRATEGIES.get(color, {})
        if cs:
            color_lines.append(
                f"- **{color}**: {cs['description']} "
                f"Preferred roles: {', '.join(cs.get('preferred_roles', {}).keys())}"
            )
    color_guidance = "\n".join(color_lines) if color_lines else "No color-specific guidance."

    prompt = QC_REVIEW_PROMPT.format(
        leader_name=leader.get("name", ""),
        leader_id=leader["id"],
        leader_colors=", ".join(leader.get("colors", [])),
        leader_families=", ".join(leader.get("families", [])),
        leader_ability=leader.get("ability", "N/A"),
        strategy=strategy,
        playstyle_context=playstyle_context,
        color_guidance=color_guidance,
        total_cards=len(deck),
        deck_summary=_build_deck_summary(leader, deck),
        validation_summary=validation_report.summary
        if hasattr(validation_report, "summary")
        else str(validation_report),
        replacement_pool=_build_replacement_pool(candidates, deck_ids),
    )

    try:
        raw_text = await llm_complete("", prompt, prefer="smart", max_tokens=2048)
        raw_text = strip_json_fences(raw_text)

        review = json.loads(raw_text)

    except LLMNotAvailableError as e:
        logger.warning(f"QC review skipped — no LLM available: {e}")
        return deck, {"verdict": "SKIP", "reasoning": str(e)}
    except (json.JSONDecodeError, IndexError, KeyError) as e:
        logger.warning(f"QC review parse error: {e}")
        return deck, {
            "verdict": "SKIP",
            "reasoning": f"Failed to parse QC response: {e}",
        }
    except Exception as e:
        logger.warning(f"QC review API error: {e}")
        return deck, {"verdict": "SKIP", "reasoning": f"API error: {e}"}

    verdict = review.get("verdict", "PASS")
    swaps = review.get("swaps", [])

    if verdict == "PASS" or not swaps:
        logger.info(f"QC PASSED: {review.get('reasoning', '')}")
        return deck, review

    # Apply swaps
    logger.info(f"QC NEEDS_FIXES: {len(swaps)} swaps proposed")
    candidate_map = {c["id"]: c for c in candidates}
    modified = list(deck)
    applied_swaps = []

    for swap in swaps[:8]:  # Max 8 swaps
        remove_id = swap.get("remove_id", "")
        add_id = swap.get("add_id", "")

        # Validate swap is legal
        if add_id not in candidate_map:
            logger.debug(f"  Skip swap: {add_id} not in candidate pool")
            continue

        # Check add_id won't exceed 4 copies
        current_count = sum(1 for c in modified if c["id"] == add_id)
        if current_count >= 4:
            logger.debug(f"  Skip swap: {add_id} already at 4 copies")
            continue

        # Find and remove ONE copy of remove_id
        removed = False
        for i, c in enumerate(modified):
            if c["id"] == remove_id:
                modified.pop(i)
                removed = True
                break

        if not removed:
            logger.debug(f"  Skip swap: {remove_id} not found in deck")
            continue

        # Add the replacement
        modified.append(candidate_map[add_id])
        applied_swaps.append(swap)
        logger.info(f"  Swap: -{remove_id} +{add_id} — {swap.get('add_reason', '')}")

    review["swaps_applied"] = len(applied_swaps)
    review["swaps"] = applied_swaps

    return modified, review
