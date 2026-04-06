"""Deck validation, analysis, and saved deck management API endpoints."""

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from neo4j import AsyncDriver

from backend.services.llm_service import (
    LLMNotAvailableError,
    has_any_llm_key,
    llm_complete,
    strip_json_fences,
)
from backend.graph.connection import get_driver
from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck
from backend.ai.deck_suggestions import suggest_fixes
from backend.simulator.analytics import (
    aggregate_deck_health,
    compute_detailed_sim_stats,
)
from backend.storage.redis_client import get_redis
from backend.api.models import (
    DeckAnalyzeRequest,
    DeckAnalyzeResponse,
    DeckImproveRequest,
    DeckImproveResponse,
    Improvement,
    ImprovementCard,
    AggregateAnalysisRequest,
    CardHealthEntry,
    DeckHealthAnalysisResponse,
    MatchupAnalysisRequest,
    MatchupAnalysisResponse,
    MatchupSpread,
    SynergyPair,
    SaveDeckRequest,
    SavedDeckResponse,
    SavedDeckListItem,
    SimHistoryEntry,
    SimHistoryRequest,
    SimHistoryResponse,
    ValidationSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deck", tags=["deck"])

# Shared keyword map for role-based card search
ROLE_KEYWORDS_MAP: dict[str, list[str]] = {
    "blocker": ["Blocker"],
    "removal": ["KO", "Bounce", "Trash"],
    "finisher": ["Rush", "Double Attack"],
    "draw": ["Draw", "Search"],
    "rush": ["Rush"],
    "counter": [],  # special: high counter value cards
}


async def find_role_candidates(
    driver: AsyncDriver,
    leader_id: str,
    deck_card_ids: list[str],
    role: str,
    exclude_ids: list[str],
    limit: int = 5,
) -> list[dict]:
    """Find candidate cards for a given role, matching leader colors and sorted by synergy."""
    role_keywords = ROLE_KEYWORDS_MAP.get(role.lower(), [])
    is_counter_role = role.lower() == "counter"

    async with driver.session() as session:
        if is_counter_role:
            neo_result = await session.run(
                """
                MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                WITH collect(lc.name) AS leader_colors
                MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                WHERE color.name IN leader_colors
                  AND c.card_type IN ['CHARACTER', 'EVENT']
                  AND NOT c.id IN $exclude_ids
                  AND c.counter IS NOT NULL AND c.counter > 0
                OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                WHERE deck_card.id IN $deck_card_ids
                WITH c, count(DISTINCT deck_card) AS synergy_count
                RETURN c.id AS card_id, c.name AS name,
                       c.image_small AS image,
                       c.power AS power, c.cost AS cost,
                       c.counter AS counter, synergy_count
                ORDER BY c.counter DESC, synergy_count DESC
                LIMIT $limit
                """,
                leader_id=leader_id,
                exclude_ids=exclude_ids,
                deck_card_ids=deck_card_ids,
                limit=limit,
            )
        elif role_keywords:
            neo_result = await session.run(
                """
                MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                WITH collect(lc.name) AS leader_colors
                MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                WHERE color.name IN leader_colors
                  AND c.card_type IN ['CHARACTER', 'EVENT']
                  AND NOT c.id IN $exclude_ids
                OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
                WHERE kw.name IN $role_keywords
                WITH c, count(DISTINCT kw) AS role_match, leader_colors
                WHERE role_match > 0
                OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                WHERE deck_card.id IN $deck_card_ids
                WITH c, role_match, count(DISTINCT deck_card) AS synergy_count
                RETURN c.id AS card_id, c.name AS name,
                       c.image_small AS image,
                       c.power AS power, c.cost AS cost,
                       c.counter AS counter, synergy_count
                ORDER BY synergy_count DESC, role_match DESC, c.power DESC
                LIMIT $limit
                """,
                leader_id=leader_id,
                exclude_ids=exclude_ids,
                deck_card_ids=deck_card_ids,
                role_keywords=role_keywords,
                limit=limit,
            )
        else:
            neo_result = await session.run(
                """
                MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                WITH collect(lc.name) AS leader_colors
                MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                WHERE color.name IN leader_colors
                  AND c.card_type IN ['CHARACTER', 'EVENT']
                  AND NOT c.id IN $exclude_ids
                OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                WHERE deck_card.id IN $deck_card_ids
                WITH c, count(DISTINCT deck_card) AS synergy_count
                RETURN c.id AS card_id, c.name AS name,
                       c.image_small AS image,
                       c.power AS power, c.cost AS cost,
                       c.counter AS counter, synergy_count
                ORDER BY synergy_count DESC, c.power DESC
                LIMIT $limit
                """,
                leader_id=leader_id,
                exclude_ids=exclude_ids,
                deck_card_ids=deck_card_ids,
                limit=limit,
            )

        candidates = []
        async for rec in neo_result:
            candidates.append({
                "card_id": rec["card_id"],
                "name": rec["name"] or "",
                "image": rec["image"] or "",
                "power": rec["power"] or 0,
                "cost": rec["cost"] or 0,
                "counter": rec["counter"] or 0,
                "synergy_count": rec["synergy_count"] or 0,
            })
        return candidates

DECK_TTL_SECONDS = 90 * 24 * 3600  # 90 days


def _find_sim_dir(sim_id: str) -> Path | None:
    """Find simulation directory by sim_id (supports both old UUID and new timestamped format)."""
    base = Path("data/simulations")
    if not base.exists():
        return None
    for d in base.iterdir():
        if d.is_dir() and sim_id[:8] in d.name:
            return d
    old_path = base / sim_id
    if old_path.exists():
        return old_path
    return None


MAX_SAVED_DECKS = 50


async def _get_driver() -> AsyncDriver:
    return await get_driver()


class DeckValidateRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


@router.post("/validate")
async def validate(
    req: DeckValidateRequest, driver: AsyncDriver = Depends(_get_driver)
):
    """Validate a deck against official OPTCG rules and competitive quality standards.

    Returns a detailed report with PASS/FAIL/WARNING for each check.
    """
    # Fetch leader
    leader = await get_card_by_id(driver, req.leader_id)
    if leader is None:
        raise HTTPException(status_code=404, detail=f"Leader {req.leader_id} not found")

    # Fetch all cards
    cards = []
    missing = []
    for card_id in req.card_ids:
        card = await get_card_by_id(driver, card_id)
        if card is None:
            missing.append(card_id)
        else:
            cards.append(card)

    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Cards not found: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}",
        )

    report = validate_deck(leader, cards)
    return report.to_dict()


@router.post("/suggest-fixes")
async def suggest(req: DeckValidateRequest, driver: AsyncDriver = Depends(_get_driver)):
    """Generate smart replacement suggestions for deck validation issues.

    Returns suggestions ranked by priority (rule fixes first, then quality improvements).
    Each suggestion includes a card to remove, a card to add, and reasoning.
    """
    return await suggest_fixes(driver, req.leader_id, req.card_ids)


def _compute_deck_hash(card_ids: list[str]) -> str:
    """Compute a short deterministic hash for a deck's card list."""
    return hashlib.md5(json.dumps(sorted(card_ids)).encode()).hexdigest()[:12]


async def _fetch_cards(
    driver: AsyncDriver, card_ids: list[str]
) -> tuple[list[dict], list[str]]:
    """Fetch card data for a list of IDs. Returns (cards, missing_ids)."""
    cards: list[dict] = []
    missing: list[str] = []
    for card_id in card_ids:
        card = await get_card_by_id(driver, card_id)
        if card is None:
            missing.append(card_id)
        else:
            cards.append(card)
    return cards, missing


async def _compute_synergy_score(driver: AsyncDriver, card_ids: list[str]) -> int:
    """Compute a 0-100 synergy score based on SYNERGY edges between deck cards."""
    unique_ids = list(set(card_ids))
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (a:Card)-[s:SYNERGY]-(b:Card)
            WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
            RETURN count(s) AS edge_count
            """,
            ids=unique_ids,
        )
        record = await result.single()
        edge_count = record["edge_count"] if record else 0

    # Normalize: ~50 unique cards, max possible edges ~1225
    # A well-synergized deck typically has 50-200 edges
    n = len(unique_ids)
    max_edges = n * (n - 1) // 2 if n > 1 else 1
    raw_ratio = edge_count / max_edges
    # Scale to 0-100 with a reasonable curve (0.15 ratio = ~85 score)
    score = min(100, int(raw_ratio * 600))
    return max(0, score)


def _classify_playstyle(cards: list[dict]) -> str:
    """Detect playstyle from cost distribution."""
    costs = [c.get("cost") or 0 for c in cards if c.get("cost") is not None]
    if not costs:
        return "midrange"
    avg_cost = sum(costs) / len(costs)
    if avg_cost < 3.5:
        return "aggro"
    elif avg_cost > 5.0:
        return "control"
    return "midrange"


def _count_card_roles(cards: list[dict]) -> dict[str, int]:
    """Count cards by strategic role based on keywords."""
    roles: dict[str, int] = {
        "blockers": 0,
        "removal": 0,
        "draw": 0,
        "searcher": 0,
        "rush": 0,
        "finishers": 0,
    }
    for card in cards:
        keywords = set(card.get("keywords") or [])
        if "Blocker" in keywords:
            roles["blockers"] += 1
        if keywords & {"KO", "Bounce", "Trash", "Power Debuff"}:
            roles["removal"] += 1
        if "Draw" in keywords:
            roles["draw"] += 1
        if "Search" in keywords:
            roles["searcher"] += 1
        if "Rush" in keywords:
            roles["rush"] += 1
        if (card.get("cost") or 0) >= 7 and (card.get("power") or 0) >= 7000:
            roles["finishers"] += 1
    return roles


def _compute_cost_curve(cards: list[dict]) -> dict[str, int]:
    """Compute cost distribution buckets."""
    curve: dict[str, int] = {"0-2": 0, "3-5": 0, "6-7": 0, "8+": 0}
    for card in cards:
        cost = card.get("cost")
        if cost is None:
            continue
        if cost <= 2:
            curve["0-2"] += 1
        elif cost <= 5:
            curve["3-5"] += 1
        elif cost <= 7:
            curve["6-7"] += 1
        else:
            curve["8+"] += 1
    return curve


@router.post("/analyze", response_model=DeckAnalyzeResponse)
async def analyze_deck(
    req: DeckAnalyzeRequest,
    driver: AsyncDriver = Depends(_get_driver),
) -> DeckAnalyzeResponse:
    """Full deck analysis: validation, playstyle, synergy score, suggestions, roles, cost curve."""
    leader = await get_card_by_id(driver, req.leader_id)
    if leader is None:
        raise HTTPException(status_code=404, detail=f"Leader {req.leader_id} not found")

    cards, missing = await _fetch_cards(driver, req.card_ids)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Cards not found: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}",
        )

    try:
        # Validation
        report = validate_deck(leader, cards)
        validation = ValidationSummary(
            checks=[
                {"name": c.name, "status": c.status, "message": c.message}
                for c in report.checks
            ],
            pass_count=len(report.passes),
            fail_count=len(report.fails),
            warning_count=len(report.warnings),
        )

        # Suggestions
        fix_result = await suggest_fixes(driver, req.leader_id, req.card_ids)
        suggestions = fix_result.get("suggestions", [])

        # Synergy score
        synergy_score = await _compute_synergy_score(driver, req.card_ids)

        # Playstyle, roles, cost curve
        playstyle = _classify_playstyle(cards)
        card_roles = _count_card_roles(cards)
        cost_curve = _compute_cost_curve(cards)

        return DeckAnalyzeResponse(
            validation=validation,
            playstyle=playstyle,
            synergy_score=synergy_score,
            suggestions=suggestions,
            card_roles=card_roles,
            cost_curve=cost_curve,
        )
    except Exception as e:
        logger.exception("Deck analysis failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@router.post("/sim-history", response_model=SimHistoryResponse)
async def get_sim_history(req: SimHistoryRequest) -> SimHistoryResponse:
    """Get simulation history for a specific deck composition."""
    try:
        r = await get_redis()
        deck_hash = _compute_deck_hash(req.card_ids)
        redis_key = f"deck-sims:{req.leader_id}:{deck_hash}"

        raw_entries = await r.lrange(redis_key, 0, -1)
        simulations: list[SimHistoryEntry] = []
        stale_indices: list[int] = []
        for idx, raw in enumerate(raw_entries):
            try:
                data = json.loads(raw)
                sim_id = data.get("sim_id", "")
                # Verify simulation data still exists on disk
                if sim_id and not _find_sim_dir(sim_id):
                    stale_indices.append(idx)
                    continue
                simulations.append(SimHistoryEntry(**data))
            except (json.JSONDecodeError, ValueError):
                stale_indices.append(idx)
                continue

        # Clean up stale entries from Redis (deleted sim data)
        if stale_indices:
            # Remove stale entries by setting to sentinel then removing
            pipe = r.pipeline()
            sentinel = "__STALE__"
            for idx in stale_indices:
                await r.lset(redis_key, idx, sentinel)  # type: ignore[arg-type]
            await r.lrem(redis_key, 0, sentinel)  # type: ignore[arg-type]
            await pipe.execute()

        return SimHistoryResponse(simulations=simulations)
    except Exception as e:
        logger.exception("Failed to fetch simulation history")
        raise HTTPException(status_code=500, detail=f"Failed to fetch sim history: {e}")


@router.post("/clear-sim-history")
async def clear_sim_history(req: SimHistoryRequest) -> dict[str, str]:
    """Delete all simulation history for a specific deck composition."""
    try:
        r = await get_redis()
        deck_hash = _compute_deck_hash(req.card_ids)
        redis_key = f"deck-sims:{req.leader_id}:{deck_hash}"

        # Get sim_ids to delete disk data
        raw_entries = await r.lrange(redis_key, 0, -1)
        deleted_count = 0
        for raw in raw_entries:
            try:
                data = json.loads(raw)
                sim_id = data.get("sim_id", "")
                sim_dir = _find_sim_dir(sim_id)
                if sim_dir and sim_dir.exists():
                    import shutil

                    shutil.rmtree(sim_dir)
                    deleted_count += 1
            except (json.JSONDecodeError, ValueError, OSError):
                continue

        # Clear Redis keys
        await r.delete(redis_key)
        agg_key = f"aggregate-analysis:v1:{req.leader_id}:{deck_hash}"
        await r.delete(agg_key)
        # Clear per-matchup analysis caches
        for raw in raw_entries:
            try:
                data = json.loads(raw)
                sim_id = data.get("sim_id", "")
                if sim_id:
                    await r.delete(f"matchup-analysis:v2:{sim_id}")
            except (json.JSONDecodeError, ValueError):
                continue

        return {"status": "ok", "message": f"Cleared {deleted_count} simulations"}
    except Exception as e:
        logger.exception("Failed to clear simulation history")
        raise HTTPException(500, f"Failed to clear sim history: {e}")


@router.post("/improve", response_model=DeckImproveResponse)
async def improve_deck(
    req: DeckImproveRequest,
    driver: AsyncDriver = Depends(_get_driver),
) -> DeckImproveResponse:
    """AI-powered deck improvement suggestions, optionally using simulation stats."""
    leader = await get_card_by_id(driver, req.leader_id)
    if leader is None:
        raise HTTPException(status_code=404, detail=f"Leader {req.leader_id} not found")

    cards, missing = await _fetch_cards(driver, req.card_ids)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Cards not found: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}",
        )

    try:
        # Get replacement suggestions (includes validation internally)
        fix_result = await suggest_fixes(driver, req.leader_id, req.card_ids)
        existing_suggestions = fix_result.get("suggestions", [])

        improvements: list[Improvement] = []
        used_remove_ids: set[str] = set()
        used_add_ids: set[str] = set()

        # If sim stats provided, identify weak cards (win_correlation < 0.3)
        if req.sim_card_stats:
            weak_cards = [
                (card_id, stats)
                for card_id, stats in req.sim_card_stats.items()
                if stats.win_correlation < 0.3 and stats.times_played >= 3
            ]
            # Sort by worst performing first
            weak_cards.sort(key=lambda x: x[1].win_correlation)

            # Try to find replacements from existing suggestions
            for card_id, stats in weak_cards[:5]:
                card_data = next((c for c in cards if c["id"] == card_id), None)
                card_name = card_data.get("name", card_id) if card_data else card_id

                # Find a matching suggestion that adds a card not yet used
                replacement = None
                for sug in existing_suggestions:
                    add_id = sug.get("add", {}).get("id", "")
                    if add_id and add_id not in used_add_ids and add_id != card_id:
                        replacement = sug["add"]
                        used_add_ids.add(add_id)
                        break

                if replacement:
                    win_pct = int(stats.win_correlation * 100)
                    improvements.append(
                        Improvement(
                            action="swap",
                            remove=ImprovementCard(
                                card_id=card_id,
                                card_name=card_name,
                                reason=f"Low win correlation ({win_pct}%)",
                            ),
                            add=ImprovementCard(
                                card_id=replacement["id"],
                                card_name=replacement.get("name", ""),
                                reason=replacement.get(
                                    "benefit", "Better synergy with deck"
                                ),
                            ),
                            impact="high",
                        )
                    )
                    used_remove_ids.add(card_id)

        # Add remaining suggestions from validation warnings
        for sug in existing_suggestions:
            remove_id = sug.get("remove", {}).get("id", "")
            add_id = sug.get("add", {}).get("id", "")
            if remove_id in used_remove_ids or add_id in used_add_ids:
                continue

            priority = sug.get("priority", "low")
            impact = (
                "high"
                if priority == "high"
                else ("medium" if priority == "medium" else "low")
            )

            improvements.append(
                Improvement(
                    action="swap",
                    remove=ImprovementCard(
                        card_id=remove_id,
                        card_name=sug.get("remove", {}).get("name", ""),
                        reason=sug.get("remove", {}).get("reason", ""),
                    ),
                    add=ImprovementCard(
                        card_id=add_id,
                        card_name=sug.get("add", {}).get("name", ""),
                        reason=sug.get("add", {}).get("benefit", ""),
                    ),
                    impact=impact,
                )
            )
            used_remove_ids.add(remove_id)
            used_add_ids.add(add_id)

        # Sort by impact
        impact_order = {"high": 0, "medium": 1, "low": 2}
        improvements.sort(key=lambda imp: impact_order.get(imp.impact, 9))

        # Generate summary
        n = len(improvements)
        if n == 0:
            summary = "No improvements needed — deck looks strong"
        else:
            areas: list[str] = []
            if any(imp.impact == "high" for imp in improvements):
                areas.append("critical fixes")
            role_counts = _count_card_roles(cards)
            if role_counts["blockers"] < 4:
                areas.append("defensive coverage")
            if role_counts["finishers"] < 2:
                areas.append("late-game presence")
            if role_counts["removal"] < 4:
                areas.append("counter density")
            area_text = " and ".join(areas[:3]) if areas else "overall synergy"
            summary = f"{n} improvement{'s' if n != 1 else ''} suggested to strengthen {area_text}"

        return DeckImproveResponse(improvements=improvements, summary=summary)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Deck improvement analysis failed")
        raise HTTPException(status_code=500, detail=f"Improvement analysis failed: {e}")


@router.get("/sim-detail/{sim_id}")
async def get_sim_detail(sim_id: str) -> dict:
    """Get detailed simulation results from exported JSONL files."""
    sim_dir = _find_sim_dir(sim_id)
    if not sim_dir:
        raise HTTPException(404, "Simulation data not found")

    metadata: dict = {}
    games: list[dict] = []

    meta_path = sim_dir / "metadata.json"
    if meta_path.exists():
        metadata = json.loads(meta_path.read_text())

    games_path = sim_dir / "games.jsonl"
    if games_path.exists():
        with games_path.open() as f:
            games = [json.loads(line) for line in f if line.strip()]

    return {
        "metadata": metadata,
        "games": games,
    }


@router.post("/analyze-matchup", response_model=MatchupAnalysisResponse)
async def analyze_matchup(
    req: MatchupAnalysisRequest,
    driver: AsyncDriver = Depends(_get_driver),
) -> MatchupAnalysisResponse:
    """AI-powered matchup analysis using simulation data."""
    # Check Redis cache first
    cache_key = f"matchup-analysis:v2:{req.sim_id}"
    try:
        r = await get_redis()
        cached = await r.get(cache_key)
        if cached:
            data = json.loads(cached if isinstance(cached, str) else cached.decode())
            return MatchupAnalysisResponse(**data)
    except Exception:
        pass  # Cache miss or Redis error — proceed with fresh analysis

    sim_dir = _find_sim_dir(req.sim_id)
    if not sim_dir:
        raise HTTPException(404, "Simulation data not found")

    # Read metadata
    metadata: dict = {}
    meta_path = sim_dir / "metadata.json"
    if meta_path.exists():
        metadata = json.loads(meta_path.read_text())

    # Read games
    games: list[dict] = []
    games_path = sim_dir / "games.jsonl"
    if games_path.exists():
        with games_path.open() as f:
            games = [json.loads(line) for line in f if line.strip()]

    if not games:
        raise HTTPException(404, "No game data found for this simulation")

    # Compute matchup stats
    wins = sum(1 for g in games if g.get("winner") == "p1")
    num_games = len(games)
    win_rate = round(wins / num_games * 100, 1) if num_games else 0.0
    avg_turns = (
        round(sum(g.get("turns", 0) for g in games) / num_games, 1)
        if num_games
        else 0.0
    )

    leader_id = req.leader_id
    leader_name = metadata.get("p1_leader", leader_id)
    opponent_leader = metadata.get("p2_leader", "Unknown")

    # Build per-game summary
    games_summary_lines: list[str] = []
    for i, g in enumerate(games[:20], 1):  # Cap at 20 games for prompt size
        winner = g.get("winner", "?")
        turns = g.get("turns", "?")
        games_summary_lines.append(
            f"Game {i}: {'Win' if winner == 'p1' else 'Loss'}, {turns} turns"
        )
    games_summary = "\n".join(games_summary_lines)

    # Compute card stats from games.jsonl (p1_cards_played per game)
    card_play_counts: dict[str, int] = {}
    card_win_counts: dict[str, int] = {}
    for g in games:
        for card_id, count in g.get("p1_cards_played", {}).items():
            card_play_counts[card_id] = card_play_counts.get(card_id, 0) + count
            if g.get("winner") == "p1":
                card_win_counts[card_id] = card_win_counts.get(card_id, 0) + 1

    card_stats_lines: list[str] = []
    for card_id, played in sorted(card_play_counts.items(), key=lambda x: -x[1]):
        win_games = card_win_counts.get(card_id, 0)
        total_games_played = sum(
            1 for g in games if card_id in g.get("p1_cards_played", {})
        )
        win_corr = win_games / total_games_played if total_games_played > 0 else 0.0
        card_stats_lines.append(
            f"  {card_id}: played {played}x in {total_games_played} games, win correlation {win_corr:.0%}"
        )
    card_stats_summary = (
        "\n".join(card_stats_lines)
        if card_stats_lines
        else "No card-level stats available"
    )

    # Build enhanced stats from games data
    p1_damage = [g.get("p1_damage_dealt", 0) for g in games]
    p2_damage = [g.get("p2_damage_dealt", 0) for g in games]
    p1_effects = [g.get("p1_effects_fired", 0) for g in games]
    p2_effects = [g.get("p2_effects_fired", 0) for g in games]
    mulligans_p1 = sum(1 for g in games if g.get("p1_mulligan"))
    mulligans_p2 = sum(1 for g in games if g.get("p2_mulligan"))
    enhanced_stats_text = (
        f"Avg P1 damage: {sum(p1_damage) / max(num_games, 1):.1f}, "
        f"Avg P2 damage: {sum(p2_damage) / max(num_games, 1):.1f}\n"
        f"Avg P1 effects: {sum(p1_effects) / max(num_games, 1):.1f}, "
        f"Avg P2 effects: {sum(p2_effects) / max(num_games, 1):.1f}\n"
        f"P1 mulligan: {mulligans_p1}/{num_games}, P2 mulligan: {mulligans_p2}/{num_games}"
    )

    prompt = f"""You are an OPTCG (One Piece TCG) deck analyst. Analyze this simulation data and provide improvement suggestions.

Deck: {leader_name} (Leader ID: {leader_id})
Opponent: {opponent_leader}
Results: {win_rate}% win rate over {num_games} games, avg {avg_turns} turns

Per-game breakdown:
{games_summary}

Card performance (cards played and their win correlation):
{card_stats_summary}

Enhanced stats:
{enhanced_stats_text}

Provide your analysis in this exact JSON format:
{{
  "analysis": "Overall matchup summary in 2-3 sentences",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "overperformers": [{{"card_id": "...", "card_name": "...", "reason": "..."}}],
  "underperformers": [{{"card_id": "...", "card_name": "...", "reason": "..."}}],
  "suggested_swaps": [{{"remove": "EXACT_CARD_ID", "role_needed": "blocker|removal|finisher|draw|rush|counter", "reason": "why remove and what role is needed"}}]
}}

IMPORTANT for suggested_swaps:
- For "remove", use the EXACT card_id from the card performance list above (e.g. "OP04-109", "ST10-012"). Do NOT use card names.
- For "role_needed", specify what type of replacement the deck needs: blocker, removal, finisher, draw, rush, or counter.
- Only suggest removing cards that appear in the card performance list above."""

    if not has_any_llm_key():
        raise HTTPException(
            400, "No LLM API key configured. Set one in Settings > BYOK."
        )

    try:
        raw_text = await llm_complete(
            "", prompt, prefer="fast", max_tokens=2048, timeout=60.0
        )

        # Try to parse JSON from the response
        try:
            json_text = strip_json_fences(raw_text)

            parsed = json.loads(json_text)
            result = MatchupAnalysisResponse(
                analysis=parsed.get("analysis", ""),
                strengths=parsed.get("strengths", []),
                weaknesses=parsed.get("weaknesses", []),
                overperformers=parsed.get("overperformers", []),
                underperformers=parsed.get("underperformers", []),
                suggested_swaps=parsed.get("suggested_swaps", []),
            )
        except (json.JSONDecodeError, IndexError):
            result = MatchupAnalysisResponse(analysis=raw_text)

        # Enrich suggested_swaps: resolve remove card + find candidates from Neo4j
        if result.suggested_swaps:
            enriched_swaps: list[dict] = []
            role_keywords_map: dict[str, list[str]] = {
                "blocker": ["Blocker"],
                "removal": ["KO", "Bounce", "Trash"],
                "finisher": ["Rush", "Double Attack"],
                "draw": ["Draw", "Search"],
                "rush": ["Rush"],
                "counter": [],  # high counter value cards
            }

            for swap in result.suggested_swaps:
                raw_remove = swap.get("remove", "")
                role_needed = swap.get("role_needed", "")
                reason = swap.get("reason", "")

                # Resolve remove card — expect card_id, fallback to name search
                remove_id = ""
                remove_name = ""
                remove_image = ""

                async with driver.session() as session:
                    # Try direct ID lookup first
                    neo_result = await session.run(
                        "MATCH (c:Card {id: $id}) "
                        "RETURN c.id AS id, c.name AS name, c.image_small AS image "
                        "LIMIT 1",
                        id=raw_remove,
                    )
                    record = await neo_result.single()
                    if record:
                        remove_id = record["id"]
                        remove_name = record["name"] or ""
                        remove_image = record["image"] or ""
                    else:
                        # Fallback: AI may have returned a name instead of ID
                        neo_result = await session.run(
                            "MATCH (c:Card) "
                            "WHERE toLower(c.name) CONTAINS toLower($name) "
                            "RETURN c.id AS id, c.name AS name, c.image_small AS image "
                            "LIMIT 1",
                            name=raw_remove,
                        )
                        record = await neo_result.single()
                        if record:
                            remove_id = record["id"]
                            remove_name = record["name"] or ""
                            remove_image = record["image"] or ""
                        else:
                            remove_name = raw_remove

                # Find candidate replacements from Neo4j
                role_keywords = role_keywords_map.get(role_needed.lower(), [])
                is_counter_role = role_needed.lower() == "counter"
                exclude_ids = req.card_ids + [leader_id]

                candidates: list[dict] = []
                async with driver.session() as session:
                    if is_counter_role:
                        # For counter role: find high-counter cards matching color
                        neo_result = await session.run(
                            """
                            MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                            WITH collect(lc.name) AS leader_colors
                            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                            WHERE color.name IN leader_colors
                              AND c.card_type IN ['CHARACTER', 'EVENT']
                              AND NOT c.id IN $exclude_ids
                              AND c.id <> $leader_id
                              AND c.counter IS NOT NULL
                              AND c.counter > 0
                            OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                            WHERE deck_card.id IN $deck_card_ids
                            WITH c, count(DISTINCT deck_card) AS synergy_count
                            RETURN c.id AS card_id, c.name AS name,
                                   c.image_small AS image,
                                   c.power AS power, c.cost AS cost,
                                   c.counter AS counter, synergy_count
                            ORDER BY c.counter DESC, synergy_count DESC
                            LIMIT 5
                            """,
                            leader_id=leader_id,
                            exclude_ids=exclude_ids,
                            deck_card_ids=req.card_ids,
                        )
                    elif role_keywords:
                        neo_result = await session.run(
                            """
                            MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                            WITH collect(lc.name) AS leader_colors
                            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                            WHERE color.name IN leader_colors
                              AND c.card_type IN ['CHARACTER', 'EVENT']
                              AND NOT c.id IN $exclude_ids
                              AND c.id <> $leader_id
                            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
                            WHERE kw.name IN $role_keywords
                            WITH c, count(DISTINCT kw) AS role_match, leader_colors
                            WHERE role_match > 0
                            OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                            WHERE deck_card.id IN $deck_card_ids
                            WITH c, role_match, count(DISTINCT deck_card) AS synergy_count
                            RETURN c.id AS card_id, c.name AS name,
                                   c.image_small AS image,
                                   c.power AS power, c.cost AS cost,
                                   c.counter AS counter, synergy_count
                            ORDER BY synergy_count DESC, role_match DESC, c.power DESC
                            LIMIT 5
                            """,
                            leader_id=leader_id,
                            exclude_ids=exclude_ids,
                            deck_card_ids=req.card_ids,
                            role_keywords=role_keywords,
                        )
                    else:
                        # No keywords — match any card by synergy score
                        neo_result = await session.run(
                            """
                            MATCH (leader:Card {id: $leader_id})-[:HAS_COLOR]->(lc:Color)
                            WITH collect(lc.name) AS leader_colors
                            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
                            WHERE color.name IN leader_colors
                              AND c.card_type IN ['CHARACTER', 'EVENT']
                              AND NOT c.id IN $exclude_ids
                              AND c.id <> $leader_id
                            OPTIONAL MATCH (c)-[:SYNERGY|MECHANICAL_SYNERGY]-(deck_card:Card)
                            WHERE deck_card.id IN $deck_card_ids
                            WITH c, count(DISTINCT deck_card) AS synergy_count
                            RETURN c.id AS card_id, c.name AS name,
                                   c.image_small AS image,
                                   c.power AS power, c.cost AS cost,
                                   c.counter AS counter, synergy_count
                            ORDER BY synergy_count DESC, c.power DESC
                            LIMIT 5
                            """,
                            leader_id=leader_id,
                            exclude_ids=exclude_ids,
                            deck_card_ids=req.card_ids,
                        )

                    async for rec in neo_result:
                        candidates.append(
                            {
                                "card_id": rec["card_id"],
                                "name": rec["name"] or "",
                                "image": rec["image"] or "",
                                "power": rec["power"],
                                "cost": rec["cost"],
                                "counter": rec["counter"],
                                "synergy_score": rec["synergy_count"],
                            }
                        )

                enriched_swaps.append(
                    {
                        "remove": remove_id or raw_remove,
                        "remove_name": remove_name,
                        "remove_image": remove_image,
                        "role_needed": role_needed,
                        "reason": reason,
                        "candidates": candidates,
                    }
                )
            result = MatchupAnalysisResponse(
                analysis=result.analysis,
                strengths=result.strengths,
                weaknesses=result.weaknesses,
                overperformers=result.overperformers,
                underperformers=result.underperformers,
                suggested_swaps=enriched_swaps,
            )

        # Enrich with detailed stats from decisions + snapshots
        try:
            detailed = compute_detailed_sim_stats(sim_dir.name)
            if detailed:
                result = result.model_copy(update={"detailed_stats": detailed})
        except Exception:
            logger.debug("Could not compute detailed sim stats", exc_info=True)

        # Cache in Redis (7 days)
        try:
            await r.set(cache_key, result.model_dump_json(), ex=7 * 86400)
        except Exception:
            pass
        return result

    except LLMNotAvailableError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Matchup analysis failed")
        raise HTTPException(500, f"Analysis failed: {e}")


@router.post("/aggregate-analysis", response_model=DeckHealthAnalysisResponse)
async def aggregate_analysis(
    req: AggregateAnalysisRequest,
    driver: AsyncDriver = Depends(_get_driver),
) -> DeckHealthAnalysisResponse:
    """AI-powered holistic deck health analysis across all simulations."""
    deck_hash = _compute_deck_hash(req.card_ids)
    cache_key = f"aggregate-analysis:v1:{req.leader_id}:{deck_hash}"

    # Check Redis cache
    try:
        r = await get_redis()
        cached = await r.get(cache_key)
        if cached:
            data = json.loads(cached if isinstance(cached, str) else cached.decode())
            return DeckHealthAnalysisResponse(**data)
    except Exception:
        pass

    # Find all sim_ids for this deck from Redis
    r = await get_redis()
    redis_key = f"deck-sims:{req.leader_id}:{deck_hash}"
    raw_entries = await r.lrange(redis_key, 0, -1)

    if len(raw_entries) < 2:
        raise HTTPException(
            400,
            "Need at least 2 simulations for aggregate analysis. Run more simulations first.",
        )

    # Extract sim folders from entries
    sim_folders: list[str] = []
    for raw in raw_entries[:20]:  # Cap at 20 most recent
        try:
            data = json.loads(raw)
            sim_id = data.get("sim_id", "")
            sim_dir = _find_sim_dir(sim_id)
            if sim_dir:
                sim_folders.append(sim_dir.name)
        except (json.JSONDecodeError, ValueError):
            continue

    if len(sim_folders) < 2:
        raise HTTPException(
            400,
            "Not enough valid simulation data found on disk.",
        )

    # Compute aggregate stats
    health_data = aggregate_deck_health(sim_folders)
    if not health_data:
        raise HTTPException(500, "Failed to compute aggregate deck health")

    # Batch-fetch card names from Neo4j
    all_card_ids = set()
    for ch in health_data.get("card_health", []):
        all_card_ids.add(ch["card_id"])
    for sp in health_data.get("top_synergies", []):
        all_card_ids.add(sp["card_a"])
        all_card_ids.add(sp["card_b"])

    card_names: dict[str, str] = {}
    if all_card_ids:
        async with driver.session() as session:
            result = await session.run(
                "MATCH (c:Card) WHERE c.id IN $ids RETURN c.id AS id, c.name AS name",
                ids=list(all_card_ids),
            )
            async for rec in result:
                card_names[rec["id"]] = rec["name"] or rec["id"]

    # Get leader name
    leader = await get_card_by_id(driver, req.leader_id)
    leader_name = leader["name"] if leader else req.leader_id

    # Build card stats summary for prompt
    card_stats_lines: list[str] = []
    for ch in health_data.get("card_health", []):
        name = card_names.get(ch["card_id"], ch["card_id"])
        card_stats_lines.append(
            f"- {ch['card_id']} ({name}): played {ch['times_played']}x, "
            f"play_rate={ch['play_rate']:.0%}, win_corr={ch['win_correlation']:.0%}, "
            f"in {ch['games_appeared']}/{health_data['total_games']} games"
        )

    synergy_lines: list[str] = []
    for sp in health_data.get("top_synergies", []):
        name_a = card_names.get(sp["card_a"], sp["card_a"])
        name_b = card_names.get(sp["card_b"], sp["card_b"])
        synergy_lines.append(
            f"- {name_a} + {name_b}: co-occur {sp['co_occurrence_rate']:.0%}, "
            f"win_lift={sp['win_lift']:.2f}x"
        )

    matchup_lines: list[str] = []
    for ms in health_data.get("matchup_spread", []):
        matchup_lines.append(
            f"- vs {ms['opponent']}: {ms['win_rate']:.0%} ({ms['num_games']} games)"
        )

    action = health_data.get("action_patterns", {})

    prompt = f"""You are an OPTCG (One Piece TCG) deck health analyst. Analyze this deck's OVERALL performance across ALL simulations — focus on holistic deck health, not any specific matchup.

Deck: {leader_name} (Leader ID: {req.leader_id})
Total simulations: {len(sim_folders)} | Total games: {health_data["total_games"]} | Overall win rate: {health_data["overall_win_rate"]:.0%}

Card performance (aggregated across all matchups):
{chr(10).join(card_stats_lines) if card_stats_lines else "No card data"}

Card synergy pairs (cards that appear together in wins):
{chr(10).join(synergy_lines) if synergy_lines else "No synergy data"}

Matchup spread:
{chr(10).join(matchup_lines) if matchup_lines else "No matchup data"}

Action patterns:
- Play before attack: {action.get("play_before_attack_pct", 0):.0%}
- Leader attack rate: {action.get("leader_attack_pct", 0):.0%}
- Losing attack rate: {action.get("losing_attack_pct", 0):.0%}
- Avg decisions/game: {action.get("avg_decisions_per_game", 0):.1f}

Deck card IDs in this deck: {", ".join(req.card_ids[:10])}{"..." if len(req.card_ids) > 10 else ""}

Analyze the deck's OVERALL HEALTH — not matchup-specific. Provide your analysis in this exact JSON format:
{{
  "summary": "2-3 sentence overall deck health assessment",
  "consistency_rating": "high|medium|low",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "core_engine": [{{"card_id": "...", "reason": "why this is a core card"}}],
  "dead_cards": [{{"card_id": "...", "reason": "why this card underperforms"}}],
  "role_gaps": ["role the deck is missing, e.g. removal, draw, finisher, blocker"],
  "synergy_insights": ["insight about card synergies"],
  "improvement_priorities": ["priority 1: most impactful change", "priority 2", ...]
}}

Focus on:
1. Which cards are the deck's ENGINE (consistently played, high win correlation)?
2. Which cards are DEAD (rarely played or low win correlation)?
3. What ROLES is the deck missing?
4. Are card SYNERGIES being utilized effectively?
5. How CONSISTENT is the deck across different matchups?"""

    if not has_any_llm_key():
        raise HTTPException(
            400, "No LLM API key configured. Set one in Settings > BYOK."
        )

    try:
        raw_text = await llm_complete(
            "", prompt, prefer="fast", max_tokens=2048, timeout=60.0
        )
        json_text = strip_json_fences(raw_text)

        parsed = json.loads(json_text)

        # Build card_health entries with names
        card_health_entries = [
            CardHealthEntry(
                card_id=ch["card_id"],
                card_name=card_names.get(ch["card_id"], ch["card_id"]),
                times_played=ch["times_played"],
                play_rate=ch["play_rate"],
                win_correlation=ch["win_correlation"],
            )
            for ch in health_data.get("card_health", [])
        ]

        # Classify cards based on AI output
        core_ids = {c.get("card_id", "") for c in parsed.get("core_engine", [])}
        dead_ids = {c.get("card_id", "") for c in parsed.get("dead_cards", [])}
        for entry in card_health_entries:
            if entry.card_id in core_ids:
                entry.category = "core_engine"
            elif entry.card_id in dead_ids:
                entry.category = "dead_card"
            elif entry.play_rate >= 0.5:
                entry.category = "core_engine"
            elif entry.play_rate <= 0.1:
                entry.category = "dead_card"
            else:
                entry.category = "flex"

        # Build core_engine and dead_cards lists from AI
        core_engine = [
            CardHealthEntry(
                card_id=c.get("card_id", ""),
                card_name=card_names.get(c.get("card_id", ""), c.get("card_id", "")),
                play_rate=next(
                    (
                        ch["play_rate"]
                        for ch in health_data.get("card_health", [])
                        if ch["card_id"] == c.get("card_id")
                    ),
                    0.0,
                ),
                win_correlation=next(
                    (
                        ch["win_correlation"]
                        for ch in health_data.get("card_health", [])
                        if ch["card_id"] == c.get("card_id")
                    ),
                    0.0,
                ),
                category="core_engine",
            )
            for c in parsed.get("core_engine", [])
        ]
        dead_cards_list = [
            CardHealthEntry(
                card_id=c.get("card_id", ""),
                card_name=card_names.get(c.get("card_id", ""), c.get("card_id", "")),
                play_rate=next(
                    (
                        ch["play_rate"]
                        for ch in health_data.get("card_health", [])
                        if ch["card_id"] == c.get("card_id")
                    ),
                    0.0,
                ),
                win_correlation=next(
                    (
                        ch["win_correlation"]
                        for ch in health_data.get("card_health", [])
                        if ch["card_id"] == c.get("card_id")
                    ),
                    0.0,
                ),
                category="dead_card",
            )
            for c in parsed.get("dead_cards", [])
        ]

        # Build synergy pairs with names
        top_synergies = [
            SynergyPair(
                card_a=card_names.get(sp["card_a"], sp["card_a"]),
                card_b=card_names.get(sp["card_b"], sp["card_b"]),
                co_occurrence_rate=sp["co_occurrence_rate"],
                win_lift=sp["win_lift"],
            )
            for sp in health_data.get("top_synergies", [])
        ]

        matchup_spread_entries = [
            MatchupSpread(
                opponent=ms["opponent"],
                win_rate=ms["win_rate"],
                num_games=ms["num_games"],
            )
            for ms in health_data.get("matchup_spread", [])
        ]

        # --- Find specific replacement suggestions ---
        from backend.api.schemas.deck import ReplacementSuggestion, SwapCandidate

        suggested_swaps: list[ReplacementSuggestion] = []
        exclude_ids = list(req.card_ids) + [req.leader_id]
        suggested_card_ids: set[str] = set()  # Track to avoid duplicate candidates
        remaining_role_gaps = list(parsed.get("role_gaps", []))

        # For each dead card: suggest replacements, rotating through role gaps
        for dc in parsed.get("dead_cards", []):
            dc_id = dc.get("card_id", "")
            dc_reason = dc.get("reason", "Underperforming card")
            dc_name = card_names.get(dc_id, dc_id)

            # Look up image
            dc_image = ""
            try:
                async with driver.session() as session:
                    rec = await (
                        await session.run(
                            "MATCH (c:Card {id: $id}) RETURN c.image_small AS image LIMIT 1",
                            id=dc_id,
                        )
                    ).single()
                    if rec:
                        dc_image = rec["image"] or ""
            except Exception:
                pass

            # Pick a role gap for this dead card, then remove from list
            search_role = remaining_role_gaps.pop(0) if remaining_role_gaps else ""

            try:
                candidates_raw = await find_role_candidates(
                    driver,
                    req.leader_id,
                    req.card_ids,
                    search_role,
                    exclude_ids + list(suggested_card_ids),
                )
                candidates = [SwapCandidate(**c) for c in candidates_raw]
            except Exception:
                candidates = []

            # Truncate long role names
            display_role = search_role[:40] if search_role else ""

            if candidates:
                suggested_swaps.append(
                    ReplacementSuggestion(
                        remove_id=dc_id,
                        remove_name=dc_name,
                        remove_image=dc_image,
                        role_needed=display_role,
                        reason=dc_reason,
                        candidates=candidates,
                    )
                )
                suggested_card_ids.update(c.card_id for c in candidates)

        # For remaining role gaps without a dead card swap
        for gap in remaining_role_gaps:
            try:
                candidates_raw = await find_role_candidates(
                    driver,
                    req.leader_id,
                    req.card_ids,
                    gap,
                    exclude_ids + list(suggested_card_ids),
                )
                candidates = [SwapCandidate(**c) for c in candidates_raw]
            except Exception:
                candidates = []

            display_gap = gap[:40] if gap else ""

            if candidates:
                suggested_swaps.append(
                    ReplacementSuggestion(
                        role_needed=display_gap,
                        reason=f"Deck lacks {gap.lower()} cards",
                        candidates=candidates,
                    )
                )
                suggested_card_ids.update(c.card_id for c in candidates)

        result = DeckHealthAnalysisResponse(
            summary=parsed.get("summary", ""),
            consistency_rating=parsed.get("consistency_rating", "medium"),
            total_sims=len(sim_folders),
            total_games=health_data["total_games"],
            overall_win_rate=health_data["overall_win_rate"],
            strengths=parsed.get("strengths", []),
            weaknesses=parsed.get("weaknesses", []),
            core_engine=core_engine,
            dead_cards=dead_cards_list,
            role_gaps=parsed.get("role_gaps", []),
            synergy_insights=parsed.get("synergy_insights", []),
            improvement_priorities=parsed.get("improvement_priorities", []),
            card_health=card_health_entries,
            top_synergies=top_synergies,
            matchup_spread=matchup_spread_entries,
            suggested_swaps=suggested_swaps,
        )

        # Cache (1 hour)
        try:
            await r.set(cache_key, result.model_dump_json(), ex=3600)
        except Exception:
            pass

        return result

    except LLMNotAvailableError as e:
        raise HTTPException(400, str(e))
    except json.JSONDecodeError:
        logger.exception("Failed to parse AI response")
        raise HTTPException(502, "AI returned invalid JSON")
    except Exception as e:
        logger.exception("Aggregate analysis failed")
        raise HTTPException(500, f"Analysis failed: {e}")


# --- Saved Decks (Redis) ---


async def _get_client_id(x_client_id: str = Header(...)) -> str:
    if not x_client_id or len(x_client_id) > 64:
        raise HTTPException(400, "Invalid X-Client-Id header")
    return x_client_id


def _deck_key(client_id: str, deck_id: str) -> str:
    return f"deck:{client_id}:{deck_id}"


def _index_key(client_id: str) -> str:
    return f"deck-index:{client_id}"


@router.post("/saved", response_model=SavedDeckResponse)
async def save_deck(
    req: SaveDeckRequest,
    deck_id: str | None = Query(None, alias="id"),
    client_id: str = Depends(_get_client_id),
):
    """Save a new deck or update an existing one."""
    r = await get_redis()
    index_key = _index_key(client_id)

    if deck_id:
        # Update existing
        key = _deck_key(client_id, deck_id)
        existing = await r.get(key)
        if not existing:
            raise HTTPException(404, "Deck not found")
        old = json.loads(existing)
        created_at = old.get("created_at", datetime.now(timezone.utc).isoformat())
    else:
        # Create new — check limit
        count = await r.scard(index_key)
        if count >= MAX_SAVED_DECKS:
            raise HTTPException(400, f"Maximum {MAX_SAVED_DECKS} saved decks reached")
        deck_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

    now = datetime.now(timezone.utc).isoformat()
    deck_data = {
        "id": deck_id,
        "name": req.name,
        "description": req.description,
        "leader_id": req.leader_id,
        "entries": [e.model_dump() for e in req.entries],
        "deck_notes": req.deck_notes,
        "created_at": created_at,
        "updated_at": now,
    }

    key = _deck_key(client_id, deck_id)
    await r.set(key, json.dumps(deck_data), ex=DECK_TTL_SECONDS)
    await r.sadd(index_key, deck_id)
    await r.expire(index_key, DECK_TTL_SECONDS)

    return SavedDeckResponse(**deck_data)


@router.get("/saved", response_model=list[SavedDeckListItem])
async def list_saved_decks(client_id: str = Depends(_get_client_id)):
    """List all saved decks for this client."""
    r = await get_redis()
    index_key = _index_key(client_id)
    deck_ids = await r.smembers(index_key)

    if not deck_ids:
        return []

    # Batch fetch with pipeline
    pipe = r.pipeline()
    for did in deck_ids:
        pipe.get(_deck_key(client_id, did))
    results = await pipe.execute()

    decks: list[SavedDeckListItem] = []
    stale_ids: list[str] = []

    for did, raw in zip(deck_ids, results):
        if raw is None:
            stale_ids.append(did)
            continue
        data = json.loads(raw)
        card_count = sum(e["quantity"] for e in data.get("entries", []))
        decks.append(
            SavedDeckListItem(
                id=data["id"],
                name=data["name"],
                description=data.get("description", ""),
                leader_id=data.get("leader_id"),
                card_count=card_count,
                created_at=data["created_at"],
                updated_at=data["updated_at"],
            )
        )

    # Cleanup stale index entries
    if stale_ids:
        await r.srem(index_key, *stale_ids)

    # Sort by updated_at descending
    decks.sort(key=lambda d: d.updated_at, reverse=True)
    return decks


@router.get("/saved/{deck_id}", response_model=SavedDeckResponse)
async def get_saved_deck(
    deck_id: str,
    client_id: str = Depends(_get_client_id),
):
    """Load a saved deck."""
    r = await get_redis()
    key = _deck_key(client_id, deck_id)
    raw = await r.get(key)

    if raw is None:
        raise HTTPException(404, "Deck not found")

    # Refresh TTL on access
    await r.expire(key, DECK_TTL_SECONDS)

    data = json.loads(raw)
    return SavedDeckResponse(**data)


@router.delete("/saved/{deck_id}")
async def delete_saved_deck(
    deck_id: str,
    client_id: str = Depends(_get_client_id),
):
    """Delete a saved deck."""
    r = await get_redis()
    key = _deck_key(client_id, deck_id)

    deleted = await r.delete(key)
    if not deleted:
        raise HTTPException(404, "Deck not found")

    await r.srem(_index_key(client_id), deck_id)
    return {"ok": True}
