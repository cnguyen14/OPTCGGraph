"""AI agent API endpoints with AG-UI SSE streaming."""

import asyncio
import logging

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse
from neo4j import AsyncDriver

from backend.agent.ag_ui import stream_from_queue
from backend.agent.runtime import OPTCGAgent
from backend.agent.session import Session
from backend.agent.types import DeckContext, ModelConfig
from backend.api.models import ChatRequest
from backend.graph.connection import get_driver

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


def _build_agent(session: Session) -> OPTCGAgent:
    """Create an OPTCGAgent from session config, with provider fallback."""
    from backend.services.llm_service import MODEL_PREFERENCE
    from backend.services.settings_service import get_active_api_key

    config = session.model_config
    provider = config["provider"]
    model = config["model"]
    api_key = get_active_api_key(provider)

    # Fallback: if primary provider has no key, try the other one
    if not api_key:
        alt_provider = "openrouter" if provider in ("claude", "anthropic") else "anthropic"
        api_key = get_active_api_key(alt_provider)
        if api_key:
            provider = alt_provider
            model = MODEL_PREFERENCE.get(alt_provider, {}).get("smart", model)

    return OPTCGAgent(
        model_config=ModelConfig(
            provider=provider,
            model=model,
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
            no_synergy_card_ids=tuple(req.no_synergy_card_ids or []),
        )
    return DeckContext(leader_id=req.leader_id)


@router.post("/chat")
async def chat(
    req: ChatRequest,
    driver: AsyncDriver = Depends(_get_driver),
    x_client_id: str | None = Header(None),
):
    """AI chat endpoint with real-time AG-UI SSE streaming."""
    # Try loading existing session from Redis first
    session = None
    if req.session_id:
        session = await Session.load_from_redis(req.session_id)
    if session is None:
        session = Session(req.session_id)

    # Associate with client
    if x_client_id:
        session.client_id = x_client_id

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

    agent_task = asyncio.create_task(
        agent.run(
            message=req.message,
            driver=driver,
            conversation_history=session.get_messages(),
            current_deck=deck_context,
            selected_leader=session.selected_leader,
            active_skill=session.model_config.get("active_skill"),
            event_queue=queue,
            session_id=session.id,
        )
    )

    async def _save_session():
        """Save session after stream completes (runs as background task)."""
        try:
            result = await agent_task
            session.save_messages(list(result.messages))
            config = session.model_config
            config["active_skill"] = result.active_skill
            session.model_config = config
            await session.persist()
        except Exception:
            logger.exception("Failed to save agent session")

    async def generate():
        async for event in stream_from_queue(queue):
            yield event
        # Fire-and-forget: save session without blocking stream close
        asyncio.create_task(_save_session())

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
async def chat_sync(
    req: ChatRequest,
    driver: AsyncDriver = Depends(_get_driver),
    x_client_id: str | None = Header(None),
):
    """Non-streaming chat endpoint (for testing)."""
    session = None
    if req.session_id:
        session = await Session.load_from_redis(req.session_id)
    if session is None:
        session = Session(req.session_id)
    if x_client_id:
        session.client_id = x_client_id

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
        session_id=session.id,
    )

    session.save_messages(list(result.messages))
    config = session.model_config
    config["active_skill"] = result.active_skill
    session.model_config = config
    await session.persist()

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


# --- Agent debug logs ---


@router.get("/logs/{session_id}")
async def get_agent_logs(session_id: str):
    """Get agent trace logs for a session."""
    from backend.agent.tracer import AgentTracer

    entries = AgentTracer.load(session_id)
    return {"session_id": session_id, "entries": entries, "count": len(entries)}


# --- Session history endpoints ---


@router.get("/sessions")
async def list_sessions(client_id: str = Query(...)):
    """List chat sessions for a client, most recent first."""
    sessions = await Session.list_sessions(client_id)
    return {"sessions": sessions}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Load a full session with messages."""
    session = await Session.load_from_redis(session_id)
    if session is None:
        return {"error": "Session not found"}
    # Extract user-visible messages (filter out tool_result blocks)
    raw_msgs = session.get_messages()
    messages = []
    for m in raw_msgs:
        role = m.get("role", "")
        content = m.get("content", "")
        if role in ("user", "assistant") and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
        elif role == "assistant" and isinstance(content, list):
            # Extract text blocks from Anthropic-format assistant messages
            text_parts = [
                b.get("text", "")
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            ]
            combined = "\n".join(t for t in text_parts if t)
            if combined:
                messages.append({"role": "assistant", "content": combined})
    return {
        "session_id": session.id,
        "title": session.title,
        "messages": messages,
        "created_at": session.to_dict().get("created_at"),
        "updated_at": session.to_dict().get("updated_at"),
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, client_id: str = Query("")):
    """Delete a chat session."""
    ok = await Session.delete_session(session_id, client_id or None)
    return {"deleted": ok}
