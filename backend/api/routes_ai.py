"""AI agent API endpoints with AG-UI SSE streaming."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from neo4j import AsyncDriver

from backend.api.models import ChatRequest
from backend.graph.connection import get_driver
from backend.agent.loop import run_agent
from backend.agent.providers import get_provider
from backend.agent.session import Session
from backend.agent.ag_ui import stream_agent_response

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.post("/chat")
async def chat(req: ChatRequest, driver: AsyncDriver = Depends(_get_driver)):
    """AI chat endpoint with AG-UI SSE streaming."""
    # Get or create session
    session = Session(req.session_id)

    if req.leader_id:
        session.selected_leader = req.leader_id

    # Get provider from session config
    config = session.model_config
    provider = get_provider(config["provider"], config["model"])

    # Run agent
    result = await run_agent(
        user_message=req.message,
        provider=provider,
        driver=driver,
        conversation_history=session.get_messages(),
        current_deck=session.current_deck,
        selected_leader=session.selected_leader,
    )

    # Save updated messages
    session.save_messages(result["messages"])

    # Stream response as SSE
    return StreamingResponse(
        stream_agent_response(result),
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

    config = session.model_config
    provider = get_provider(config["provider"], config["model"])

    result = await run_agent(
        user_message=req.message,
        provider=provider,
        driver=driver,
        conversation_history=session.get_messages(),
        current_deck=session.current_deck,
        selected_leader=session.selected_leader,
    )

    session.save_messages(result["messages"])

    # Build tool call summaries for frontend display
    tool_summaries = []
    for tc in result["tool_calls"]:
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
        "text": result["text"],
        "session_id": session.id,
        "tool_calls_count": len(result["tool_calls"]),
        "tool_summaries": tool_summaries,
        "ui_updates": result["ui_updates"],
    }
