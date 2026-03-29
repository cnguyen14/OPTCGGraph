"""LLM provider abstraction — Claude (direct) and OpenRouter."""

from typing import Protocol, Any
import logging

import anthropic
import httpx

from backend.config import ANTHROPIC_API_KEY, OPENROUTER_API_KEY

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

    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        self.model = model

    async def chat(self, system: str, messages: list[dict], tools: list[dict]) -> LLMResponse:
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
        )

        content = []
        for block in response.content:
            if block.type == "text":
                content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                content.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })

        return LLMResponse(
            content=content,
            stop_reason="tool_use" if response.stop_reason == "tool_use" else "end_turn",
        )

    @property
    def tier(self) -> int:
        return 1

    @property
    def model_name(self) -> str:
        return self.model


class OpenRouterProvider:
    """OpenRouter gateway — 300+ models, user-selectable."""

    TIER_1 = ["openai/gpt-4o", "google/gemini-pro", "anthropic/claude"]
    TIER_2 = ["google/gemini-flash", "meta-llama/llama-3.1-70b"]

    def __init__(self, model: str = "openai/gpt-4o"):
        self.api_key = OPENROUTER_API_KEY
        self.model = model
        self._tier = self._detect_tier(model)

    async def chat(self, system: str, messages: list[dict], tools: list[dict]) -> LLMResponse:
        openai_tools = [
            {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
            for t in tools
        ] if self._tier >= 2 else None

        openai_messages = [{"role": "system", "content": system}] + messages

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

        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        content: list[dict] = []

        if message.get("content"):
            content.append({"type": "text", "text": message["content"]})

        tool_calls = message.get("tool_calls", [])
        stop_reason = "end_turn"
        for tc in tool_calls:
            import json
            content.append({
                "type": "tool_use",
                "id": tc.get("id", ""),
                "name": tc["function"]["name"],
                "input": json.loads(tc["function"].get("arguments", "{}")),
            })
            stop_reason = "tool_use"

        return LLMResponse(content=content, stop_reason=stop_reason)

    def _detect_tier(self, model: str) -> int:
        if any(t in model for t in self.TIER_1):
            return 1
        if any(t in model for t in self.TIER_2):
            return 2
        return 3

    @property
    def tier(self) -> int:
        return self._tier

    @property
    def model_name(self) -> str:
        return self.model


def get_provider(provider_name: str = "claude", model: str | None = None) -> LLMProvider:
    """Factory to get the right LLM provider."""
    if provider_name == "claude":
        return ClaudeProvider(model=model or "claude-sonnet-4-20250514")
    else:
        return OpenRouterProvider(model=model or "openai/gpt-4o")
