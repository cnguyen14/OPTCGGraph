"""API routes for the OPTCG battle simulator."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.graph.connection import get_driver
from backend.simulator.runner import SimulationRunner

router = APIRouter(prefix="/api/simulator", tags=["simulator"])

# In-memory store for simulation results (keyed by sim_id)
_simulations: dict[str, dict[str, Any]] = {}


VALID_AGENT_TYPES = {"heuristic", "llm", "stress_godmode", "stress_realistic"}


class BattleRequest(BaseModel):
    deck1_leader_id: str
    deck1_card_ids: list[str]
    deck2_leader_id: str
    deck2_card_ids: list[str]
    num_games: int = 10
    agent_type: str = "heuristic"
    llm_model: str | None = None


class BattleResponse(BaseModel):
    sim_id: str


@router.post("/battle", response_model=BattleResponse)
async def start_battle(req: BattleRequest) -> BattleResponse:
    """Start a battle simulation between two decks."""
    if not (1 <= req.num_games <= 50):
        raise HTTPException(400, "num_games must be between 1 and 50")
    if req.agent_type not in VALID_AGENT_TYPES:
        raise HTTPException(400, f"agent_type must be one of: {', '.join(sorted(VALID_AGENT_TYPES))}")
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
                agent_type=req["agent_type"],
                llm_model=req.get("llm_model"),
            )

            sim_data["status"] = "running"

            async for event in runner.run(
                deck1_leader_id=req["deck1_leader_id"],
                deck1_card_ids=req["deck1_card_ids"],
                deck2_leader_id=req["deck2_leader_id"],
                deck2_card_ids=req["deck2_card_ids"],
                num_games=req["num_games"],
            ):
                if event["type"] == "complete":
                    sim_data["status"] = "complete"
                    sim_data["result"] = event["result"]

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
