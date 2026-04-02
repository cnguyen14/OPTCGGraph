"""Tool framework — AgentTool dataclass, execution context, exceptions."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from neo4j import AsyncDriver

from backend.agent.types import JSONDict, ToolExecutionResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ToolPermissionError(RuntimeError):
    """Tool blocked by permission policy."""


class ToolExecutionError(RuntimeError):
    """Tool failed during execution (bad input, missing data, etc.)."""


# ---------------------------------------------------------------------------
# Execution context
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ToolExecutionContext:
    """Immutable context passed to every tool handler."""

    driver: AsyncDriver
    max_output_chars: int = 15_000


# ---------------------------------------------------------------------------
# Handler type
# ---------------------------------------------------------------------------

ToolHandler = Callable[[JSONDict, ToolExecutionContext], Awaitable[str]]


# ---------------------------------------------------------------------------
# AgentTool
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AgentTool:
    """A single tool the agent can invoke."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema
    handler: ToolHandler
    category: str = "general"

    # -- format converters ---------------------------------------------------

    def to_openai_tool(self) -> dict[str, object]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_anthropic_tool(self) -> dict[str, object]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }

    # -- execution -----------------------------------------------------------

    async def execute(
        self,
        arguments: JSONDict,
        context: ToolExecutionContext,
        guards: list[Any] | None = None,
    ) -> ToolExecutionResult:
        """Run handler with optional pre/post guardrails."""
        # 1. PRE-guards
        if guards:
            from backend.agent.guardrails import run_guards

            pre = await run_guards(guards, "pre", self.name, arguments, None, context)
            if not pre.passed:
                return ToolExecutionResult(
                    name=self.name,
                    ok=False,
                    content=f"Blocked by guardrail: {'; '.join(pre.violations)}",
                )

        # 2. Execute handler
        try:
            content = await self.handler(arguments, context)
            result = ToolExecutionResult(name=self.name, ok=True, content=content)
        except (ToolPermissionError, ToolExecutionError) as exc:
            return ToolExecutionResult(name=self.name, ok=False, content=str(exc))
        except Exception as exc:
            logger.error("Tool %s error: %s", self.name, exc)
            return ToolExecutionResult(
                name=self.name, ok=False, content=f"Internal error: {exc}"
            )

        # 3. POST-guards
        if guards:
            from backend.agent.guardrails import run_guards

            post = await run_guards(
                guards, "post", self.name, arguments, result, context
            )
            if not post.passed:
                if post.auto_fixed and post.fixed_data:
                    return ToolExecutionResult(
                        name=self.name,
                        ok=True,
                        content=json.dumps(post.fixed_data, default=str),
                    )
                return ToolExecutionResult(
                    name=self.name,
                    ok=False,
                    content=f"Guardrail violations: {'; '.join(post.violations)}",
                )

        return result


# ---------------------------------------------------------------------------
# Dispatch helper
# ---------------------------------------------------------------------------

async def execute_tool(
    registry: dict[str, AgentTool],
    name: str,
    arguments: JSONDict,
    context: ToolExecutionContext,
    guards: list[Any] | None = None,
) -> ToolExecutionResult:
    """Look up a tool and execute it."""
    tool = registry.get(name)
    if tool is None:
        return ToolExecutionResult(
            name=name, ok=False, content=f"Unknown tool: {name}"
        )
    return await tool.execute(arguments, context, guards)
