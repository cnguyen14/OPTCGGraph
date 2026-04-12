"""OPTCGAgent — unified agent runtime with skill-based routing."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from neo4j import AsyncDriver

from backend.agent.guardrails import build_default_guards
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
from backend.agent.tracer import AgentTracer
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
        session_id: str | None = None,
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
        tracer = AgentTracer(session_id or "anonymous")

        # 1. Route to skill
        skill = resolve_skill(message, active_skill, self.skills)
        tracer.log(
            "skill_resolved",
            skill=skill.name,
            message=message[:200],
            tools=list(skill.allowed_tools),
        )

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
        guards = build_default_guards()
        text = ""
        text_parts: list[str] = []  # Accumulate text from all iterations
        awaiting_user_choice = False  # Stop loop when suggestions need user input

        try:
            for iteration in range(skill.max_iterations):
                logger.info(
                    "Agent iteration %d (skill=%s, model=%s)",
                    iteration + 1,
                    skill.name,
                    provider.model_name,
                )

                t0 = time.time()
                response: LLMResponse = await provider.chat(system, messages, tools_for_llm)
                llm_ms = round((time.time() - t0) * 1000, 1)
                messages.append({"role": "assistant", "content": response.content})

                tracer.log(
                    "llm_response",
                    iteration=iteration + 1,
                    model=provider.model_name,
                    latency_ms=llm_ms,
                    stop_reason=response.stop_reason,
                    tool_calls=[tc.get("name", "") for tc in response.tool_calls],
                    text_preview=response.text[:200] if response.text else "",
                )

                if response.stop_reason != "tool_use" or not response.tool_calls:
                    if response.text:
                        text_parts.append(response.text)
                    text = "\n\n".join(text_parts)
                    break

                tool_results = []
                for tc in response.tool_calls:
                    tool_name = tc["name"]
                    tool_input = tc.get("input", {})
                    tool_id = tc.get("id", "")

                    # Emit STEP_STARTED
                    await self._emit(event_queue, {"type": "STEP_STARTED", "tool": tool_name})

                    tracer.log("tool_start", tool=tool_name, input=tool_input)

                    logger.info("  Executing tool: %s", tool_name)
                    t1 = time.time()
                    result = await execute_tool(
                        self.tool_registry,
                        tool_name,
                        tool_input,
                        ctx,
                        guards=guards,
                    )
                    tool_ms = round((time.time() - t1) * 1000, 1)

                    # Parse result content for downstream processing
                    try:
                        result_data = (
                            json.loads(result.content) if result.ok else {"error": result.content}
                        )
                    except (json.JSONDecodeError, TypeError):
                        result_data = {"raw": result.content}

                    tracer.log(
                        "tool_finish",
                        tool=tool_name,
                        ok=result.ok,
                        latency_ms=tool_ms,
                        preview=result.content[:300],
                    )

                    # Emit STEP_FINISHED
                    await self._emit(
                        event_queue,
                        {
                            "type": "STEP_FINISHED",
                            "tool": tool_name,
                            "result_preview": result.content[:200],
                        },
                    )

                    # Emit suggestions if applicable
                    suggestions = _build_suggestions_from_tool(tool_name, result_data)
                    if suggestions:
                        await self._emit(
                            event_queue,
                            {
                                "type": "SUGGESTIONS",
                                "suggestions": suggestions,
                            },
                        )
                        awaiting_user_choice = True

                    all_tool_calls.append(
                        {
                            "name": tool_name,
                            "input": tool_input,
                            "result": result_data,
                        }
                    )

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

                    # Auto-emit swap suggestions for existing cards
                    if (
                        tool_name == "build_deck_shell"
                        and isinstance(result_data, dict)
                        and result_data.get("existing_card_swaps")
                    ):
                        ui_update = {
                            "action": "show_swap_suggestions",
                            "payload": {
                                "swaps": result_data["existing_card_swaps"],
                            },
                            "status": "emitted",
                        }
                        ui_updates.append(ui_update)
                        await self._emit(event_queue, {"type": "STATE_SNAPSHOT", **ui_update})

                    # Note: search_cards results are shown via card links in
                    # the chat response. Auto-emitting show_card_list was removed
                    # because it caused cascading modal issues when the agent
                    # searches multiple times (e.g., finding swap replacements).
                    # The agent can explicitly use update_ui_state(show_card_list)
                    # if it wants to open a card gallery modal.

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": json.dumps(result_data, default=str),
                        }
                    )

                messages.append({"role": "user", "content": tool_results})

                # Accumulate intermediate text from tool_use iterations
                if response.text:
                    text_parts.append(response.text)

                # After suggestions emitted, do one more LLM call without
                # build_deck_shell so it can explain the analysis, then stop.
                if awaiting_user_choice:
                    logger.info("Suggestions emitted — one more LLM call to present analysis")
                    # Remove deck-building tools so LLM can only explain
                    presentation_tools = [
                        t for t in tools_for_llm if t["name"] not in ("build_deck_shell",)
                    ]
                    t0 = time.time()
                    followup: LLMResponse = await provider.chat(
                        system, messages, presentation_tools
                    )
                    llm_ms = round((time.time() - t0) * 1000, 1)
                    # Only keep text blocks if we won't execute tool calls (prevent dangling tool_use)
                    if followup.stop_reason == "tool_use" and followup.tool_calls:
                        messages.append({"role": "assistant", "content": followup.content})
                    else:
                        safe_content = [b for b in followup.content if b.get("type") != "tool_use"]
                        messages.append(
                            {
                                "role": "assistant",
                                "content": safe_content
                                or [{"type": "text", "text": followup.text or ""}],
                            }
                        )
                    tracer.log(
                        "llm_response",
                        iteration=iteration + 1,
                        model=provider.model_name,
                        latency_ms=llm_ms,
                        stop_reason=followup.stop_reason,
                        tool_calls=[tc.get("name", "") for tc in followup.tool_calls],
                        text_preview=followup.text[:200] if followup.text else "",
                    )

                    # If LLM wants to call more tools (e.g., get_card), execute them
                    followup_text = followup.text or ""
                    if followup.stop_reason == "tool_use" and followup.tool_calls:
                        followup_results = []
                        for tc in followup.tool_calls:
                            fn = tc["name"]
                            fi = tc.get("input", {})
                            fid = tc.get("id", "")
                            await self._emit(event_queue, {"type": "STEP_STARTED", "tool": fn})
                            r = await execute_tool(self.tool_registry, fn, fi, ctx, guards=guards)
                            await self._emit(
                                event_queue,
                                {
                                    "type": "STEP_FINISHED",
                                    "tool": fn,
                                    "result_preview": r.content[:200],
                                },
                            )
                            try:
                                rd = json.loads(r.content) if r.ok else {"error": r.content}
                            except (json.JSONDecodeError, TypeError):
                                rd = {"raw": r.content}
                            all_tool_calls.append({"name": fn, "input": fi, "result": rd})
                            followup_results.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": fid,
                                    "content": json.dumps(rd, default=str),
                                }
                            )
                        messages.append({"role": "user", "content": followup_results})
                        # Final text generation after tool calls
                        t0 = time.time()
                        final: LLMResponse = await provider.chat(
                            system, messages, presentation_tools
                        )
                        # Strip tool_use blocks to prevent dangling tool_use in conversation history
                        final_content = [b for b in final.content if b.get("type") != "tool_use"]
                        messages.append(
                            {
                                "role": "assistant",
                                "content": final_content
                                or [{"type": "text", "text": final.text or ""}],
                            }
                        )
                        # Combine followup analysis text with final text
                        final_text = final.text or ""
                        text = (
                            (followup_text + "\n\n" + final_text).strip()
                            if final_text
                            else followup_text
                        )
                    else:
                        text = followup_text

                    logger.info("Pausing agent loop — awaiting user playstyle choice")
                    break

            # Fallback: if loop ended without break (hit max_iterations), join accumulated text
            if not text and text_parts:
                text = "\n\n".join(text_parts)

            # Stream final text as chunks
            if event_queue is not None and text:
                chunk_size = 50
                for i in range(0, len(text), chunk_size):
                    await event_queue.put(
                        {
                            "type": "TextMessageContent",
                            "delta": text[i : i + chunk_size],
                        }
                    )

                # Emit deck notes if a deck was built
                built_deck = any(
                    tc["name"] == "build_deck_shell"
                    and isinstance(tc.get("result"), dict)
                    and tc["result"].get("cards")
                    for tc in all_tool_calls
                )
                if built_deck and text:
                    await self._emit(
                        event_queue,
                        {
                            "type": "STATE_SNAPSHOT",
                            "action": "update_deck_notes",
                            "payload": {"notes": text},
                        },
                    )

        except Exception as e:
            logger.error("Agent error: %s", e, exc_info=True)
            tracer.log("error", **AgentTracer.format_error(e))
            text = f"Error: {type(e).__name__}: {e}" if str(e) else f"Error: {type(e).__name__}"
            if event_queue is not None:
                await event_queue.put({"type": "TextMessageContent", "delta": text})
        finally:
            tracer.log(
                "agent_complete",
                tool_calls=len(all_tool_calls),
                skill=skill.name,
                text_length=len(text),
            )
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
