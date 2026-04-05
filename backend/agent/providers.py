"""LLM provider abstraction — Claude (direct) and OpenRouter."""

from __future__ import annotations

import json
from typing import Protocol
import logging

import anthropic
import httpx

from backend.services.settings_service import get_active_api_key

logger = logging.getLogger(__name__)


class LLMResponse:
    """Unified response from any LLM provider."""

    def __init__(self, content: list[dict], stop_reason: str, text: str = ""):
        self.content = content
        self.stop_reason = stop_reason
        self.text = text
        self.tool_calls: list[dict] = []

        # Extract tool calls and text
        for block in content:
            if block.get("type") == "tool_use":
                self.tool_calls.append(block)
            elif block.get("type") == "text":
                self.text = block.get("text", "")


class LLMProvider(Protocol):
    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> LLMResponse: ...

    @property
    def tier(self) -> int: ...

    @property
    def model_name(self) -> str: ...


class ClaudeProvider:
    """Direct Anthropic API — lowest latency, highest accuracy."""

    def __init__(
        self, model: str = "claude-sonnet-4-20250514", api_key: str | None = None
    ):
        self.client = anthropic.AsyncAnthropic(
            api_key=api_key or get_active_api_key("claude")
        )
        self.model = model

    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> LLMResponse:
        # Convert tools to Anthropic format
        anthropic_tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            }
            for t in tools
        ]

        response = await self.client.messages.create(
            model=self.model,
            system=system,
            messages=messages,
            tools=anthropic_tools,
            max_tokens=4096,
            timeout=90,
        )

        content = []
        for block in response.content:
            if block.type == "text":
                content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                content.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )

        return LLMResponse(
            content=content,
            stop_reason="tool_use"
            if response.stop_reason == "tool_use"
            else "end_turn",
        )

    @property
    def tier(self) -> int:
        return 1

    @property
    def model_name(self) -> str:
        return self.model


class OpenRouterProvider:
    """OpenRouter gateway — 300+ models, user-selectable."""

    TIER_1 = [
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "openai/gpt-4-turbo",
        "google/gemini-pro",
        "google/gemini-2.0",
        "anthropic/claude",
        "deepseek/deepseek-chat",
        "deepseek/deepseek-coder",
        "mistralai/mistral-large",
    ]
    # Tier 3 (chat-only) — explicitly listed models that lack function calling
    TIER_3 = [
        "meta-llama/llama-3.2-1b",
        "meta-llama/llama-3.2-3b",
        "google/gemma-2",
    ]

    def __init__(self, model: str = "openai/gpt-4o", api_key: str | None = None):
        self.api_key = api_key or get_active_api_key("openrouter")
        self.model = model
        self._tier = self._detect_tier(model)

    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> LLMResponse:
        openai_tools = (
            [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["parameters"],
                    },
                }
                for t in tools
            ]
            if self._tier <= 2
            else None
        )

        # Convert Anthropic-format messages to OpenAI format
        openai_messages = [{"role": "system", "content": system}]
        openai_messages.extend(self._convert_messages(messages))

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": openai_messages,
                    "tools": openai_tools,
                },
            )
            data = resp.json()

        if data.get("error"):
            logger.error("OpenRouter API error: %s", data["error"])

        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        content: list[dict] = []

        if message.get("content"):
            content.append({"type": "text", "text": message["content"]})

        tool_calls = message.get("tool_calls", [])
        stop_reason = "end_turn"
        for tc in tool_calls:
            try:
                func = tc.get("function", {})
                name = func.get("name", "")
                args = json.loads(func.get("arguments", "{}"))
                if not name:
                    logger.warning("OpenRouter returned tool_call without function name, skipping")
                    continue
                content.append(
                    {
                        "type": "tool_use",
                        "id": tc.get("id") or f"toolu_{id(tc)}",
                        "name": name,
                        "input": args,
                    }
                )
                stop_reason = "tool_use"
            except (json.JSONDecodeError, TypeError, KeyError) as exc:
                logger.warning("Failed to parse OpenRouter tool_call: %s", exc)
                continue

        return LLMResponse(content=content, stop_reason=stop_reason)

    @staticmethod
    def _convert_messages(messages: list[dict]) -> list[dict]:
        """Convert Anthropic-format messages to OpenAI chat format.

        Handles:
        - assistant messages with content blocks (tool_use, text) →
          OpenAI assistant with tool_calls
        - user messages with tool_result blocks →
          OpenAI tool role messages
        - plain string content messages → pass through
        """
        result: list[dict] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Plain string content — pass through as-is
            if isinstance(content, str):
                result.append({"role": role, "content": content})
                continue

            # List content (Anthropic block format)
            if isinstance(content, list):
                # --- Assistant message with tool_use blocks ---
                if role == "assistant":
                    text_parts = []
                    tool_calls = []
                    for block in content:
                        if isinstance(block, dict):
                            if block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                            elif block.get("type") == "tool_use":
                                tool_calls.append(
                                    {
                                        "id": block.get("id", ""),
                                        "type": "function",
                                        "function": {
                                            "name": block["name"],
                                            "arguments": json.dumps(
                                                block.get("input", {})
                                            ),
                                        },
                                    }
                                )
                    assistant_msg: dict = {
                        "role": "assistant",
                        "content": "\n".join(text_parts) if text_parts else None,
                    }
                    if tool_calls:
                        assistant_msg["tool_calls"] = tool_calls
                    result.append(assistant_msg)

                # --- User message with tool_result blocks ---
                elif role == "user":
                    has_tool_results = False
                    for block in content:
                        if (
                            isinstance(block, dict)
                            and block.get("type") == "tool_result"
                        ):
                            has_tool_results = True
                            raw_content = block.get("content", "")
                            result.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": block.get("tool_use_id", ""),
                                    "content": raw_content if isinstance(raw_content, str)
                                    else json.dumps(raw_content, default=str),
                                }
                            )
                    # If no tool_result blocks found, serialize as plain text
                    if not has_tool_results:
                        result.append({"role": "user", "content": json.dumps(content)})
            else:
                result.append({"role": role, "content": str(content)})

        return result

    def _detect_tier(self, model: str) -> int:
        if any(t in model for t in self.TIER_1):
            return 1
        if any(t in model for t in self.TIER_3):
            return 3
        # Default to tier 2 — most modern models support function calling
        return 2

    @property
    def tier(self) -> int:
        return self._tier

    @property
    def model_name(self) -> str:
        return self.model


def get_provider(
    provider_name: str = "claude",
    model: str | None = None,
    api_key: str | None = None,
) -> LLMProvider:
    """Factory to get the right LLM provider."""
    if provider_name in ("claude", "anthropic"):
        return ClaudeProvider(
            model=model or "claude-sonnet-4-20250514", api_key=api_key
        )
    else:
        return OpenRouterProvider(model=model or "openai/gpt-4o", api_key=api_key)
