"""Shared type definitions for the OPTCG AI agent system."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

JSONDict = dict[str, Any]


# ---------------------------------------------------------------------------
# Model / Provider
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ModelConfig:
    """LLM provider and model configuration."""

    provider: str = "claude"  # "claude" or "openrouter"
    model: str = "claude-sonnet-4-20250514"
    api_key: str | None = None
    temperature: float = 0.0
    timeout_seconds: float = 90.0
    tier: int = 1  # 1=full tools, 2=limited tools, 3=chat-only


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ToolCall:
    """A single tool invocation from the LLM."""

    id: str
    name: str
    arguments: JSONDict


@dataclass(frozen=True)
class AssistantTurn:
    """Parsed response from an LLM provider."""

    content: list[JSONDict] = field(default_factory=list)
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    stop_reason: str = "end_turn"


@dataclass(frozen=True)
class ToolExecutionResult:
    """Result of executing a single tool."""

    name: str
    ok: bool
    content: str  # JSON-serialized result
    raw_data: JSONDict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Agent run result
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AgentRunResult:
    """Final result of an agent run."""

    text: str
    messages: tuple[JSONDict, ...] = ()
    tool_calls: tuple[JSONDict, ...] = ()
    ui_updates: tuple[JSONDict, ...] = ()
    active_skill: str | None = None
    session_id: str | None = None


# ---------------------------------------------------------------------------
# Deck context
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DeckContext:
    """Current deck state passed through the agent pipeline."""

    leader_id: str | None = None
    card_ids: tuple[str, ...] = ()
    total_cost: float = 0.0


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AgentMessage:
    """A single message in the conversation history."""

    role: str  # "user", "assistant"
    content: str | list[JSONDict] = ""
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: tuple[JSONDict, ...] = ()

    def to_anthropic_message(self) -> JSONDict:
        """Convert to Anthropic API message format."""
        msg: JSONDict = {"role": self.role, "content": self.content}
        return msg

    def to_openai_message(self) -> JSONDict:
        """Convert to OpenAI API message format."""
        msg: JSONDict = {"role": self.role, "content": self.content}
        if self.name is not None:
            msg["name"] = self.name
        if self.tool_call_id is not None:
            msg["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            msg["tool_calls"] = list(self.tool_calls)
        return msg

    @classmethod
    def from_dict(cls, payload: JSONDict) -> AgentMessage:
        """Reconstruct from a serialized dict."""
        return cls(
            role=payload["role"],
            content=payload["content"],
            name=payload.get("name"),
            tool_call_id=payload.get("tool_call_id"),
            tool_calls=tuple(payload.get("tool_calls", ())),
        )


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SkillConfig:
    """A skill loaded from a YAML/Markdown file."""

    name: str
    description: str
    allowed_tools: tuple[str, ...] = ()
    triggers: tuple[str, ...] = ()
    max_iterations: int = 10
    instructions: str = ""  # Markdown body from skill file


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class GuardrailResult:
    """Outcome of a guardrail check."""

    passed: bool
    violations: tuple[str, ...] = ()
    auto_fixed: bool = False
    fixed_data: JSONDict | None = None


# ---------------------------------------------------------------------------
# Tool handler type alias
# ---------------------------------------------------------------------------

# Async callable: (arguments, context) -> JSON string
ToolHandler = Callable[[JSONDict, Any], Awaitable[str]]
