"""API routes for the OPTCG battle simulator."""

from __future__ import annotations

import hashlib
import json
import logging
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend.graph.connection import get_driver
from backend.storage.redis_client import get_redis
from backend.simulator.runner import SimulationRunner

logger = logging.getLogger(__name__)

SIM_HISTORY_TTL = 90 * 24 * 3600  # 90 days

router = APIRouter(prefix="/api/simulator", tags=["simulator"])

# In-memory store for simulation results (keyed by sim_id)
_simulations: dict[str, dict[str, Any]] = {}


VALID_MODES = {"virtual", "real"}
VALID_P1_LEVELS = {"new", "amateur", "pro"}
VALID_P2_LEVELS = {"easy", "medium", "hard"}


class BattleRequest(BaseModel):
    deck1_leader_id: str
    deck1_card_ids: list[str]
    deck2_leader_id: str
    deck2_card_ids: list[str]
    num_games: int = 10
    mode: str = "virtual"
    p1_level: str = "amateur"
    p2_level: str = "medium"
    llm_model: str | None = None


class BattleResponse(BaseModel):
    sim_id: str


@router.post("/battle", response_model=BattleResponse)
async def start_battle(req: BattleRequest) -> BattleResponse:
    """Start a battle simulation between two decks."""
    if not (1 <= req.num_games <= 50):
        raise HTTPException(400, "num_games must be between 1 and 50")
    if req.mode not in VALID_MODES:
        raise HTTPException(
            400, f"mode must be one of: {', '.join(sorted(VALID_MODES))}"
        )
    if req.p1_level not in VALID_P1_LEVELS:
        raise HTTPException(
            400, f"p1_level must be one of: {', '.join(sorted(VALID_P1_LEVELS))}"
        )
    if req.p2_level not in VALID_P2_LEVELS:
        raise HTTPException(
            400, f"p2_level must be one of: {', '.join(sorted(VALID_P2_LEVELS))}"
        )
    if len(req.deck1_card_ids) != 50:
        raise HTTPException(400, "deck1 must have exactly 50 cards")
    if len(req.deck2_card_ids) != 50:
        raise HTTPException(400, "deck2 must have exactly 50 cards")

    sim_id = str(uuid.uuid4())
    _simulations[sim_id] = {
        "status": "pending",
        "request": req.model_dump(),
    }

    return BattleResponse(sim_id=sim_id)


async def _store_sim_history(
    sim_id: str, req: dict[str, Any], result: dict[str, Any]
) -> None:
    """Store a simulation result summary in Redis, keyed by deck composition."""
    deck1_card_ids = req.get("deck1_card_ids", [])
    leader_id = req.get("deck1_leader_id", "")
    deck_hash = hashlib.md5(json.dumps(sorted(deck1_card_ids)).encode()).hexdigest()[:12]
    redis_key = f"deck-sims:{leader_id}:{deck_hash}"

    # Extract summary from result
    summary = result.get("summary", {})
    entry = {
        "sim_id": sim_id,
        "opponent_leader": req.get("deck2_leader_id", ""),
        "win_rate": summary.get("p1_win_rate", 0.0),
        "num_games": req.get("num_games", 0),
        "avg_turns": summary.get("avg_turns", 0.0),
        "mode": req.get("mode", "virtual"),
        "model": req.get("llm_model", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    r = await get_redis()
    await r.lpush(redis_key, json.dumps(entry))
    # Trim to keep last 100 entries
    await r.ltrim(redis_key, 0, 99)
    await r.expire(redis_key, SIM_HISTORY_TTL)


@router.get("/status/{sim_id}")
async def stream_simulation(sim_id: str) -> StreamingResponse:
    """Stream simulation progress via SSE."""
    if sim_id not in _simulations:
        raise HTTPException(404, "Simulation not found")

    sim_data = _simulations[sim_id]
    if sim_data["status"] == "complete":
        raise HTTPException(400, "Simulation already complete")

    req = sim_data["request"]

    async def event_stream():
        try:
            driver = await get_driver()
            runner = SimulationRunner(
                driver=driver,
                mode=req.get("mode", "virtual"),
                p1_level=req.get("p1_level", "amateur"),
                p2_level=req.get("p2_level", "medium"),
                llm_model=req.get("llm_model"),
                base_seed=random.randint(0, 2**31),
            )

            sim_data["status"] = "running"

            async for event in runner.run(
                deck1_leader_id=req["deck1_leader_id"],
                deck1_card_ids=req["deck1_card_ids"],
                deck2_leader_id=req["deck2_leader_id"],
                deck2_card_ids=req["deck2_card_ids"],
                num_games=req["num_games"],
                sim_id=sim_id,
            ):
                if event["type"] == "complete":
                    sim_data["status"] = "complete"
                    sim_data["result"] = event["result"]

                    # Store simulation summary in Redis for deck sim-history
                    try:
                        await _store_sim_history(sim_id, req, event["result"])
                    except Exception:
                        logger.warning("Failed to store sim history in Redis", exc_info=True)

                yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:
            sim_data["status"] = "error"
            sim_data["error"] = str(e)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/result/{sim_id}")
async def get_result(sim_id: str) -> dict[str, Any]:
    """Get the result of a completed simulation."""
    if sim_id not in _simulations:
        raise HTTPException(404, "Simulation not found")

    sim_data = _simulations[sim_id]
    if sim_data["status"] != "complete":
        raise HTTPException(400, f"Simulation status: {sim_data['status']}")

    return sim_data["result"]


@router.get("/export/{sim_id}/{file_type}")
async def export_simulation_data(sim_id: str, file_type: str) -> FileResponse:
    """Download exported simulation data files.

    file_type: "decisions", "games", "snapshots", or "metadata"
    """
    file_map = {
        "decisions": "decisions.jsonl",
        "games": "games.jsonl",
        "snapshots": "snapshots.jsonl",
        "metadata": "metadata.json",
    }
    if file_type not in file_map:
        raise HTTPException(400, f"file_type must be one of: {', '.join(file_map)}")

    file_path = Path("data/simulations") / sim_id / file_map[file_type]
    if not file_path.exists():
        raise HTTPException(404, f"Export file not found: {file_type}")

    media = "application/json" if file_type == "metadata" else "application/x-ndjson"
    return FileResponse(
        path=str(file_path),
        filename=file_map[file_type],
        media_type=media,
    )
