"""Output limits guardrail — cap response sizes to prevent context overflow."""

from __future__ import annotations

import json
from typing import Any

from backend.agent.types import GuardrailResult, JSONDict, ToolExecutionResult

MAX_OUTPUT_CHARS = 30_000
MAX_CYPHER_RECORDS = 200
MAX_CARD_LIST = 100


class OutputLimitsGuard:
    """POST-guard: truncate oversized tool outputs."""

    @property
    def name(self) -> str:
        return "output_limits"

    @property
    def applies_to(self) -> tuple[str, ...]:
        return ()  # Empty = applies to ALL tools

    async def check_pre(
        self, tool_name: str, arguments: JSONDict, ctx: Any
    ) -> GuardrailResult:
        return GuardrailResult(passed=True)

    async def check_post(
        self, tool_name: str, arguments: JSONDict, result: ToolExecutionResult, ctx: Any
    ) -> GuardrailResult:
        if not result.ok:
            return GuardrailResult(passed=True)

        content = result.content

        # Check raw size
        if len(content) <= MAX_OUTPUT_CHARS:
            return GuardrailResult(passed=True)

        # Try to intelligently truncate
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            # Raw string too long — truncate head/tail
            return _truncate_string(content)

        truncated = False

        # Truncate Cypher results
        if "results" in data and isinstance(data["results"], list):
            if len(data["results"]) > MAX_CYPHER_RECORDS:
                data["results"] = data["results"][:MAX_CYPHER_RECORDS]
                data["_truncated"] = True
                data["_original_count"] = data.get("count", "unknown")
                data["count"] = len(data["results"])
                truncated = True

        # Truncate card lists
        for key in ("cards", "recommended_cards", "partners", "counters"):
            if key in data and isinstance(data[key], list) and len(data[key]) > MAX_CARD_LIST:
                data[key] = data[key][:MAX_CARD_LIST]
                data["_truncated"] = True
                truncated = True

        if truncated:
            new_content = json.dumps(data, default=str)
            if len(new_content) <= MAX_OUTPUT_CHARS:
                return GuardrailResult(
                    passed=False,
                    auto_fixed=True,
                    fixed_data=data,
                    violations=("Output truncated to fit context limits",),
                )

        # Still too big after truncation — hard truncate
        if len(content) > MAX_OUTPUT_CHARS:
            return _truncate_string(content)

        return GuardrailResult(passed=True)


def _truncate_string(content: str) -> GuardrailResult:
    """Hard truncate with head/tail pattern."""
    half = MAX_OUTPUT_CHARS // 2
    truncated_content = content[:half] + "\n...[truncated]...\n" + content[-half:]
    return GuardrailResult(
        passed=False,
        auto_fixed=True,
        fixed_data={"_truncated_output": truncated_content},
        violations=(f"Output truncated from {len(content)} to {MAX_OUTPUT_CHARS} chars",),
    )
