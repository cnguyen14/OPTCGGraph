"""AG-UI event emitter for SSE streaming to frontend."""

import asyncio
import json
import uuid
from typing import AsyncGenerator


class AGUIEmitter:
    """Emits AG-UI protocol events as SSE data."""

    def __init__(self):
        self.events: list[dict] = []

    def emit(self, event_type: str, data: dict | None = None) -> dict:
        """Create an AG-UI event."""
        event = {
            "type": event_type,
            "id": str(uuid.uuid4()),
            "data": data or {},
        }
        self.events.append(event)
        return event


async def stream_agent_response(result: dict) -> AsyncGenerator[str, None]:
    """Stream agent response as SSE events following AG-UI protocol."""

    # RUN_STARTED
    yield _sse_event("RUN_STARTED", {})

    # Stream tool calls as steps
    for tc in result.get("tool_calls", []):
        yield _sse_event("STEP_STARTED", {"tool": tc["name"]})
        yield _sse_event(
            "STEP_FINISHED", {"tool": tc["name"], "result_preview": str(tc["result"])[:200]}
        )

    # UI state updates
    for ui in result.get("ui_updates", []):
        yield _sse_event("STATE_SNAPSHOT", ui)

    # Text message streaming (simulate chunks)
    text = result.get("text", "")
    if text:
        msg_id = str(uuid.uuid4())
        yield _sse_event("TextMessageStart", {"messageId": msg_id, "role": "assistant"})
        # Stream in chunks
        chunk_size = 50
        for i in range(0, len(text), chunk_size):
            yield _sse_event(
                "TextMessageContent", {"messageId": msg_id, "delta": text[i : i + chunk_size]}
            )
        yield _sse_event("TextMessageEnd", {"messageId": msg_id})

    # RUN_FINISHED
    yield _sse_event("RUN_FINISHED", {})


async def stream_from_queue(queue: asyncio.Queue) -> AsyncGenerator[str, None]:
    """Stream SSE events from an asyncio.Queue in real-time.

    Reads events pushed by run_agent_streaming() and yields them as SSE.
    Stops when it receives None sentinel.
    """
    yield _sse_event("RUN_STARTED", {})

    while True:
        event = await queue.get()
        if event is None:
            break
        event_type = event["type"]
        data = {k: v for k, v in event.items() if k != "type"}
        yield _sse_event(event_type, data)

    yield _sse_event("RUN_FINISHED", {})


def _sse_event(event_type: str, data: dict) -> str:
    """Format as SSE event string."""
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"
