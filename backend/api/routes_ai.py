"""AI agent API endpoints with AG-UI SSE streaming."""

import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from neo4j import AsyncDriver

from backend.api.models import ChatRequest
from backend.graph.connection import get_driver
from backend.agent.runtime import OPTCGAgent
from backend.agent.types import DeckContext, ModelConfig
from backend.agent.session import Session
from backend.agent.ag_ui import stream_from_queue

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


def _build_agent(session: Session) -> OPTCGAgent:
    """Create an OPTCGAgent from session config."""
    from backend.services.settings_service import get_active_api_key

    config = session.model_config
    api_key = get_active_api_key(config["provider"])
    return OPTCGAgent(
        model_config=ModelConfig(
            provider=config["provider"],
            model=config["model"],
            api_key=api_key or None,
        ),
    )


def _build_deck_context(req: ChatRequest) -> DeckContext:
    """Build DeckContext from request."""
    if req.deck_card_ids:
        return DeckContext(
            leader_id=req.leader_id,
            card_ids=tuple(req.deck_card_ids),
            total_cost=len(req.deck_card_ids),
        )
    return DeckContext(leader_id=req.leader_id)


@router.post("/chat")
async def chat(req: ChatRequest, driver: AsyncDriver = Depends(_get_driver)):
    """AI chat endpoint with real-time AG-UI SSE streaming."""
    session = Session(req.session_id)

    if req.leader_id:
        session.selected_leader = req.leader_id
    if req.deck_card_ids:
        session.current_deck = {
            "leader": req.leader_id,
            "cards": req.deck_card_ids,
            "total_cost": len(req.deck_card_ids),
        }

    agent = _build_agent(session)
    deck_context = _build_deck_context(req)
    queue: asyncio.Queue = asyncio.Queue()

    agent_task = asyncio.create_task(agent.run(
        message=req.message,
        driver=driver,
        conversation_history=session.get_messages(),
        current_deck=deck_context,
        selected_leader=session.selected_leader,
        active_skill=session.model_config.get("active_skill"),
        event_queue=queue,
    ))

    async def generate():
        async for event in stream_from_queue(queue):
            yield event
        result = await agent_task
        session.save_messages(list(result.messages))
        # Persist active skill for context continuity
        config = session.model_config
        config["active_skill"] = result.active_skill
        session.model_config = config

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Session-ID": session.id,
        },
    )


@router.post("/chat/sync")
async def chat_sync(req: ChatRequest, driver: AsyncDriver = Depends(_get_driver)):
    """Non-streaming chat endpoint (for testing)."""
    session = Session(req.session_id)

    if req.leader_id:
        session.selected_leader = req.leader_id
    if req.deck_card_ids:
        session.current_deck = {
            "leader": req.leader_id,
            "cards": req.deck_card_ids,
            "total_cost": len(req.deck_card_ids),
        }

    agent = _build_agent(session)
    deck_context = _build_deck_context(req)

    result = await agent.run(
        message=req.message,
        driver=driver,
        conversation_history=session.get_messages(),
        current_deck=deck_context,
        selected_leader=session.selected_leader,
        active_skill=session.model_config.get("active_skill"),
    )

    session.save_messages(list(result.messages))
    config = session.model_config
    config["active_skill"] = result.active_skill
    session.model_config = config

    # Build tool call summaries for frontend display
    tool_summaries = []
    for tc in result.tool_calls:
        name = tc["name"]
        inp = tc.get("input", {})
        if name == "get_card":
            tool_summaries.append(f"Looked up card {inp.get('card_id', '?')}")
        elif name == "find_synergies":
            tool_summaries.append(f"Found synergies for {inp.get('card_id', '?')}")
        elif name == "find_counters":
            tool_summaries.append(f"Found counters for {inp.get('target_card_id', '?')}")
        elif name == "query_neo4j":
            tool_summaries.append("Queried knowledge graph")
        elif name == "build_deck_shell":
            tool_summaries.append(f"Built deck for leader {inp.get('leader_id', '?')}")
        elif name == "get_mana_curve":
            tool_summaries.append("Analyzed mana curve")
        else:
            tool_summaries.append(f"Used {name}")

    return {
        "text": result.text,
        "session_id": session.id,
        "active_skill": result.active_skill,
        "tool_calls_count": len(result.tool_calls),
        "tool_summaries": tool_summaries,
        "ui_updates": list(result.ui_updates),
    }
