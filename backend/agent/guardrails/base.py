"""Guardrail framework — protocol and runner for pre/post tool guards."""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

from backend.agent.types import GuardrailResult, JSONDict, ToolExecutionResult

logger = logging.getLogger(__name__)


@runtime_checkable
class Guardrail(Protocol):
    """A pre or post guard on tool execution."""

    @property
    def name(self) -> str: ...

    @property
    def applies_to(self) -> tuple[str, ...]:
        """Tool names this guard applies to. Empty tuple = all tools."""
        ...

    async def check_pre(
        self,
        tool_name: str,
        arguments: JSONDict,
        ctx: Any,
    ) -> GuardrailResult:
        """Run before tool execution. Return violations to block."""
        ...

    async def check_post(
        self,
        tool_name: str,
        arguments: JSONDict,
        result: ToolExecutionResult,
        ctx: Any,
    ) -> GuardrailResult:
        """Run after tool execution. Can auto-fix or inject error."""
        ...


_PASS = GuardrailResult(passed=True)


async def run_guards(
    guards: list[Any],
    phase: str,
    tool_name: str,
    arguments: JSONDict,
    result: ToolExecutionResult | None,
    ctx: Any,
) -> GuardrailResult:
    """Run all applicable guards for a phase. First violation stops."""
    for guard in guards:
        # Check if this guard applies to this tool
        applies = guard.applies_to
        if applies and tool_name not in applies:
            continue

        try:
            if phase == "pre":
                check_result = await guard.check_pre(tool_name, arguments, ctx)
            elif phase == "post" and result is not None:
                check_result = await guard.check_post(tool_name, arguments, result, ctx)
            else:
                continue

            if not check_result.passed:
                logger.warning(
                    "Guardrail %s [%s] blocked %s: %s",
                    guard.name,
                    phase,
                    tool_name,
                    check_result.violations,
                )
                return check_result
        except Exception as exc:
            logger.error("Guardrail %s error: %s", guard.name, exc)
            # Guardrail errors should not block execution
            continue

    return _PASS
