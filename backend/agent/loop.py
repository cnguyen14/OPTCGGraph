"""Core agentic loop — while tool_use, execute tools, feed results back."""

import asyncio
import logging

from neo4j import AsyncDriver

from backend.agent.providers import LLMProvider, LLMResponse
from backend.agent.tools import AGENT_TOOLS
from backend.agent.tool_executor import execute_tool
from backend.ai.game_rules import build_system_prompt
from backend.graph.queries import get_banned_cards

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 10


def _build_suggestions_from_tool(tool_name: str, result: dict) -> list[dict] | None:
    """Return suggestion options if a tool result warrants user choice, else None."""
    if tool_name == "analyze_leader_playstyles" and isinstance(result, dict):
        playstyles = result.get("playstyles", [])
        if playstyles:
            return [
                {
                    "label": p["name"],
                    "value": f"I want the {p['name']} playstyle",
                    "description": p.get("description", ""),
                }
                for p in playstyles[:5]
            ]
    return None


async def run_agent(
    user_message: str,
    provider: LLMProvider,
    driver: AsyncDriver,
    conversation_history: list[dict] | None = None,
    current_deck: dict | None = None,
    selected_leader: str | None = None,
) -> dict:
    """Run the agentic loop. Returns final response and updated history.

    Returns:
        {
            "text": str,           # Final text response
            "messages": list,      # Updated conversation history
            "tool_calls": list,    # All tool calls made
            "ui_updates": list,    # UI state updates to emit
        }
    """
    messages = list(conversation_history or [])
    messages.append({"role": "user", "content": user_message})

    # Fetch banned cards to inject into system prompt
    banned_cards = await get_banned_cards(driver)
    system = await build_system_prompt(current_deck, selected_leader, banned_cards)

    # Use tools based on provider tier (Tier 1-2 get tools, Tier 3 chat-only)
    tools = AGENT_TOOLS if provider.tier <= 2 else []

    all_tool_calls: list[dict] = []
    ui_updates: list[dict] = []
    iteration = 0

    while iteration < MAX_ITERATIONS:
        iteration += 1
        logger.info(f"Agent iteration {iteration} (model: {provider.model_name})")

        response: LLMResponse = await provider.chat(system, messages, tools)

        # Append assistant response
        messages.append({"role": "assistant", "content": response.content})

        # If no tool use, we're done
        if response.stop_reason != "tool_use" or not response.tool_calls:
            break

        # Execute all tool calls
        tool_results = []
        for tc in response.tool_calls:
            tool_name = tc["name"]
            tool_input = tc.get("input", {})
            tool_id = tc.get("id", "")

            logger.info(f"  Executing tool: {tool_name}")
            result = await execute_tool(tool_name, tool_input, driver)

            all_tool_calls.append({
                "name": tool_name,
                "input": tool_input,
                "result": result,
            })

            # Collect UI updates
            if tool_name == "update_ui_state":
                ui_updates.append(result)

            # Auto-emit deck update when build_deck_shell succeeds
            if tool_name == "build_deck_shell" and isinstance(result, dict) and result.get("cards"):
                ui_updates.append({
                    "action": "update_deck_list",
                    "payload": {
                        "leader_id": result.get("leader", {}).get("id"),
                        "cards": [c["id"] for c in result["cards"]],
                    },
                    "status": "emitted",
                })

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": str(result),
            })

        # Feed tool results back
        messages.append({"role": "user", "content": tool_results})

    return {
        "text": response.text,
        "messages": messages,
        "tool_calls": all_tool_calls,
        "ui_updates": ui_updates,
    }


async def run_agent_streaming(
    user_message: str,
    provider: LLMProvider,
    driver: AsyncDriver,
    event_queue: asyncio.Queue,
    conversation_history: list[dict] | None = None,
    current_deck: dict | None = None,
    selected_leader: str | None = None,
) -> dict:
    """Run the agentic loop, pushing SSE events to queue in real-time.

    Returns same dict as run_agent() for session persistence.
    """
    messages = list(conversation_history or [])
    messages.append({"role": "user", "content": user_message})

    banned_cards = await get_banned_cards(driver)
    system = await build_system_prompt(current_deck, selected_leader, banned_cards)
    tools = AGENT_TOOLS if provider.tier <= 2 else []

    all_tool_calls: list[dict] = []
    ui_updates: list[dict] = []
    iteration = 0
    response: LLMResponse | None = None

    try:
        while iteration < MAX_ITERATIONS:
            iteration += 1
            logger.info(f"Agent iteration {iteration} (model: {provider.model_name})")

            response = await provider.chat(system, messages, tools)
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use" or not response.tool_calls:
                break

            tool_results = []
            for tc in response.tool_calls:
                tool_name = tc["name"]
                tool_input = tc.get("input", {})
                tool_id = tc.get("id", "")

                # Push STEP_STARTED before execution
                await event_queue.put({"type": "STEP_STARTED", "tool": tool_name})

                logger.info(f"  Executing tool: {tool_name}")
                result = await execute_tool(tool_name, tool_input, driver)

                # Push STEP_FINISHED after execution
                await event_queue.put({
                    "type": "STEP_FINISHED",
                    "tool": tool_name,
                    "result_preview": str(result)[:200],
                })

                # Emit suggestion buttons if tool result warrants user choice
                if isinstance(result, dict):
                    suggestions = _build_suggestions_from_tool(tool_name, result)
                    if suggestions:
                        await event_queue.put({"type": "SUGGESTIONS", "suggestions": suggestions})

                all_tool_calls.append({
                    "name": tool_name,
                    "input": tool_input,
                    "result": result,
                })

                # Push UI updates immediately
                if tool_name == "update_ui_state":
                    ui_updates.append(result)
                    await event_queue.put({"type": "STATE_SNAPSHOT", **result})

                if tool_name == "build_deck_shell" and isinstance(result, dict) and result.get("cards"):
                    ui_update = {
                        "action": "update_deck_list",
                        "payload": {
                            "leader_id": result.get("leader", {}).get("id"),
                            "cards": [c["id"] for c in result["cards"]],
                        },
                        "status": "emitted",
                    }
                    ui_updates.append(ui_update)
                    await event_queue.put({"type": "STATE_SNAPSHOT", **ui_update})

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": str(result),
                })

            messages.append({"role": "user", "content": tool_results})

        # Stream final text as chunks
        text = response.text if response else ""
        chunk_size = 50
        for i in range(0, len(text), chunk_size):
            await event_queue.put({"type": "TextMessageContent", "delta": text[i:i + chunk_size]})

        # If a deck was built, emit the explanation as deck notes
        built_deck = any(tc["name"] == "build_deck_shell" for tc in all_tool_calls if isinstance(tc.get("result"), dict) and tc["result"].get("cards"))
        if built_deck and text:
            await event_queue.put({
                "type": "STATE_SNAPSHOT",
                "action": "update_deck_notes",
                "payload": {"notes": text},
            })

    except Exception as e:
        logger.error(f"Agent streaming error: {e}")
        await event_queue.put({"type": "TextMessageContent", "delta": f"Error: {e}"})
        text = f"Error: {e}"
    finally:
        # Sentinel: streaming done
        await event_queue.put(None)

    return {
        "text": text,
        "messages": messages,
        "tool_calls": all_tool_calls,
        "ui_updates": ui_updates,
    }
