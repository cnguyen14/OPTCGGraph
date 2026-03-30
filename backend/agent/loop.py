"""Core agentic loop — while tool_use, execute tools, feed results back."""

import logging

from neo4j import AsyncDriver

from backend.agent.providers import LLMProvider, LLMResponse
from backend.agent.tools import AGENT_TOOLS
from backend.agent.tool_executor import execute_tool
from backend.ai.game_rules import build_system_prompt

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 10


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

    system = build_system_prompt(current_deck, selected_leader)

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
