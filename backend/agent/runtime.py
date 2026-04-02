"""OPTCGAgent — unified agent runtime with skill-based routing."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from neo4j import AsyncDriver

from backend.agent.prompts import render_system_prompt
from backend.agent.providers import LLMResponse, get_provider
from backend.agent.router import resolve_skill
from backend.agent.skills import load_all_skills
from backend.agent.tools import (
    AgentTool,
    ToolExecutionContext,
    build_tool_registry,
    execute_tool,
    filter_tools,
)
from backend.agent.types import (
    AgentRunResult,
    DeckContext,
    JSONDict,
    ModelConfig,
    SkillConfig,
)
from backend.graph.queries import get_banned_cards

logger = logging.getLogger(__name__)


def _build_suggestions_from_tool(tool_name: str, result: Any) -> list[dict] | None:
    """Return suggestion options if a tool result warrants user choice."""
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


@dataclass
class OPTCGAgent:
    """Unified agent runtime with skill-based routing and optional streaming."""

    model_config: ModelConfig = field(default_factory=ModelConfig)
    tool_registry: dict[str, AgentTool] = field(default_factory=build_tool_registry)
    skills: dict[str, SkillConfig] = field(default_factory=load_all_skills)

    async def run(
        self,
        message: str,
        driver: AsyncDriver,
        *,
        conversation_history: list[dict] | None = None,
        current_deck: DeckContext = DeckContext(),
        selected_leader: str | None = None,
        active_skill: str | None = None,
        event_queue: asyncio.Queue | None = None,
    ) -> AgentRunResult:
        """Run the agent loop.

        Args:
            message: User message.
            driver: Neo4j async driver.
            conversation_history: Previous messages.
            current_deck: Current deck context.
            selected_leader: Selected leader card ID.
            active_skill: Previously active skill (for context continuity).
            event_queue: If provided, push SSE events in real-time (streaming mode).
                         If None, run silently (sync mode).

        Returns:
            AgentRunResult with text, messages, tool calls, UI updates, and active skill.
        """
        # 1. Route to skill
        skill = resolve_skill(message, active_skill, self.skills)

        # 2. Filter tools for this skill (or all tools if tier allows)
        provider = get_provider(
            self.model_config.provider,
            self.model_config.model,
            api_key=self.model_config.api_key,
        )
        if provider.tier <= 2:
            skill_tools = filter_tools(self.tool_registry, skill.allowed_tools)
        else:
            skill_tools = {}  # Tier 3 = chat-only

        # 3. Build system prompt = base + context + skill instructions
        banned_cards = await get_banned_cards(driver)
        system = render_system_prompt(skill, current_deck, banned_cards, selected_leader)

        # Convert tools to list-of-dicts for the provider
        tools_for_llm = [
            {"name": t.name, "description": t.description, "parameters": t.parameters}
            for t in skill_tools.values()
        ]

        # 4. Agent loop
        messages = list(conversation_history or [])
        messages.append({"role": "user", "content": message})

        all_tool_calls: list[JSONDict] = []
        ui_updates: list[JSONDict] = []
        ctx = ToolExecutionContext(driver=driver)
        text = ""

        try:
            for iteration in range(skill.max_iterations):
                logger.info(
                    "Agent iteration %d (skill=%s, model=%s)",
                    iteration + 1, skill.name, provider.model_name,
                )

                response: LLMResponse = await provider.chat(system, messages, tools_for_llm)
                messages.append({"role": "assistant", "content": response.content})

                if response.stop_reason != "tool_use" or not response.tool_calls:
                    text = response.text
                    break

                tool_results = []
                for tc in response.tool_calls:
                    tool_name = tc["name"]
                    tool_input = tc.get("input", {})
                    tool_id = tc.get("id", "")

                    # Emit STEP_STARTED
                    await self._emit(event_queue, {"type": "STEP_STARTED", "tool": tool_name})

                    logger.info("  Executing tool: %s", tool_name)
                    result = await execute_tool(
                        self.tool_registry, tool_name, tool_input, ctx
                    )

                    # Parse result content for downstream processing
                    try:
                        result_data = json.loads(result.content) if result.ok else {"error": result.content}
                    except (json.JSONDecodeError, TypeError):
                        result_data = {"raw": result.content}

                    # Emit STEP_FINISHED
                    await self._emit(event_queue, {
                        "type": "STEP_FINISHED",
                        "tool": tool_name,
                        "result_preview": result.content[:200],
                    })

                    # Emit suggestions if applicable
                    suggestions = _build_suggestions_from_tool(tool_name, result_data)
                    if suggestions:
                        await self._emit(event_queue, {
                            "type": "SUGGESTIONS",
                            "suggestions": suggestions,
                        })

                    all_tool_calls.append({
                        "name": tool_name,
                        "input": tool_input,
                        "result": result_data,
                    })

                    # UI updates
                    if tool_name == "update_ui_state":
                        ui_updates.append(result_data)
                        await self._emit(event_queue, {"type": "STATE_SNAPSHOT", **result_data})

                    # Auto-emit deck update on build success
                    if (
                        tool_name == "build_deck_shell"
                        and isinstance(result_data, dict)
                        and result_data.get("cards")
                    ):
                        ui_update = {
                            "action": "update_deck_list",
                            "payload": {
                                "leader_id": result_data.get("leader", {}).get("id"),
                                "cards": [c["id"] for c in result_data["cards"]],
                            },
                            "status": "emitted",
                        }
                        ui_updates.append(ui_update)
                        await self._emit(event_queue, {"type": "STATE_SNAPSHOT", **ui_update})

                    # Use the original dict/string representation for tool results
                    # (matching the old format for Anthropic API compatibility)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": str(result_data),
                    })

                messages.append({"role": "user", "content": tool_results})

            # Stream final text as chunks
            if event_queue is not None and text:
                chunk_size = 50
                for i in range(0, len(text), chunk_size):
                    await event_queue.put({
                        "type": "TextMessageContent",
                        "delta": text[i : i + chunk_size],
                    })

                # Emit deck notes if a deck was built
                built_deck = any(
                    tc["name"] == "build_deck_shell"
                    and isinstance(tc.get("result"), dict)
                    and tc["result"].get("cards")
                    for tc in all_tool_calls
                )
                if built_deck and text:
                    await self._emit(event_queue, {
                        "type": "STATE_SNAPSHOT",
                        "action": "update_deck_notes",
                        "payload": {"notes": text},
                    })

        except Exception as e:
            logger.error("Agent error: %s", e)
            text = f"Error: {e}"
            if event_queue is not None:
                await event_queue.put({"type": "TextMessageContent", "delta": text})
        finally:
            if event_queue is not None:
                await event_queue.put(None)  # Sentinel: streaming done

        return AgentRunResult(
            text=text,
            messages=tuple(messages),
            tool_calls=tuple(all_tool_calls),
            ui_updates=tuple(ui_updates),
            active_skill=skill.name,
        )

    @staticmethod
    async def _emit(queue: asyncio.Queue | None, event: dict) -> None:
        """Push an event to the queue if streaming, otherwise no-op."""
        if queue is not None:
            await queue.put(event)
