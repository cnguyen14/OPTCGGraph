"""Cypher safety guardrail — block write operations in Neo4j queries."""

from __future__ import annotations

import re
from typing import Any

from backend.agent.types import GuardrailResult, JSONDict, ToolExecutionResult

_WRITE_PATTERN = re.compile(
    r"\b(CREATE|DELETE|DETACH\s+DELETE|SET|MERGE|REMOVE|DROP|CALL\s*\{)\b",
    re.IGNORECASE,
)


class CypherSafetyGuard:
    """PRE-guard: block write operations in query_neo4j tool calls."""

    @property
    def name(self) -> str:
        return "cypher_safety"

    @property
    def applies_to(self) -> tuple[str, ...]:
        return ("query_neo4j",)

    async def check_pre(
        self, tool_name: str, arguments: JSONDict, ctx: Any
    ) -> GuardrailResult:
        cypher = arguments.get("cypher", "")
        if _WRITE_PATTERN.search(cypher):
            return GuardrailResult(
                passed=False,
                violations=(
                    "Write operations (CREATE, DELETE, SET, MERGE, DROP, REMOVE) "
                    "are not allowed in agent Cypher queries. Use read-only queries.",
                ),
            )
        return GuardrailResult(passed=True)

    async def check_post(
        self, tool_name: str, arguments: JSONDict, result: ToolExecutionResult, ctx: Any
    ) -> GuardrailResult:
        return GuardrailResult(passed=True)
