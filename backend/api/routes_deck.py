"""Deck validation, analysis, and saved deck management API endpoints."""

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from neo4j import AsyncDriver

from backend.config import ANTHROPIC_API_KEY
from backend.graph.connection import get_driver
from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck
from backend.ai.deck_suggestions import suggest_fixes
from backend.storage.redis_client import get_redis
from backend.api.models import (
    DeckAnalyzeRequest,
    DeckAnalyzeResponse,
    DeckImproveRequest,
    DeckImproveResponse,
    Improvement,
    ImprovementCard,
    MatchupAnalysisRequest,
    MatchupAnalysisResponse,
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

DECK_TTL_SECONDS = 90 * 24 * 3600  # 90 days
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
        "draw_search": 0,
        "rush": 0,
        "finishers": 0,
    }
    for card in cards:
        keywords = set(card.get("keywords") or [])
        if "Blocker" in keywords:
            roles["blockers"] += 1
        if keywords & {"KO", "Bounce", "Trash", "Power Debuff"}:
            roles["removal"] += 1
        if keywords & {"Draw", "Search"}:
            roles["draw_search"] += 1
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
        for raw in raw_entries:
            try:
                data = json.loads(raw)
                simulations.append(SimHistoryEntry(**data))
            except (json.JSONDecodeError, ValueError):
                continue

        return SimHistoryResponse(simulations=simulations)
    except Exception as e:
        logger.exception("Failed to fetch simulation history")
        raise HTTPException(status_code=500, detail=f"Failed to fetch sim history: {e}")


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
    sim_dir = Path("data/simulations") / sim_id
    if not sim_dir.exists():
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
async def analyze_matchup(req: MatchupAnalysisRequest) -> MatchupAnalysisResponse:
    """AI-powered matchup analysis using simulation data."""
    sim_dir = Path("data/simulations") / req.sim_id
    if not sim_dir.exists():
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
        round(sum(g.get("total_turns", 0) for g in games) / num_games, 1)
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
        turns = g.get("total_turns", "?")
        games_summary_lines.append(
            f"Game {i}: {'Win' if winner == 'p1' else 'Loss'}, {turns} turns"
        )
    games_summary = "\n".join(games_summary_lines)

    # Card stats from metadata or games
    card_stats = metadata.get("card_stats", {})
    card_stats_lines: list[str] = []
    for card_id, stats in card_stats.items():
        played = stats.get("times_played", 0)
        win_corr = stats.get("win_correlation", 0.0)
        card_stats_lines.append(
            f"  {card_id}: played {played}x, win correlation {win_corr:.2f}"
        )
    card_stats_summary = (
        "\n".join(card_stats_lines)
        if card_stats_lines
        else "No card-level stats available"
    )

    enhanced_stats = metadata.get("enhanced_stats", {})
    enhanced_stats_text = (
        json.dumps(enhanced_stats, indent=2)
        if enhanced_stats
        else "No enhanced stats available"
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
  "suggested_swaps": [{{"remove": "card_name", "add": "suggested_card", "reason": "..."}}]
}}"""

    try:
        client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            timeout=60.0,
        )
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        raw_text = response.content[0].text.strip()

        # Try to parse JSON from the response
        try:
            # Handle possible markdown code fences
            json_text = raw_text
            if "```json" in json_text:
                json_text = json_text.split("```json")[1].split("```")[0].strip()
            elif "```" in json_text:
                json_text = json_text.split("```")[1].split("```")[0].strip()

            parsed = json.loads(json_text)
            return MatchupAnalysisResponse(
                analysis=parsed.get("analysis", ""),
                strengths=parsed.get("strengths", []),
                weaknesses=parsed.get("weaknesses", []),
                overperformers=parsed.get("overperformers", []),
                underperformers=parsed.get("underperformers", []),
                suggested_swaps=parsed.get("suggested_swaps", []),
            )
        except (json.JSONDecodeError, IndexError):
            # Fallback: return raw text as analysis
            return MatchupAnalysisResponse(analysis=raw_text)

    except anthropic.APIError as e:
        logger.exception("Claude API error during matchup analysis")
        raise HTTPException(502, f"AI analysis failed: {e}")
    except Exception as e:
        logger.exception("Matchup analysis failed")
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
