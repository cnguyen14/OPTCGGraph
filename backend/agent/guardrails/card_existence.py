"""Card existence guardrail — verify all card IDs exist in Neo4j."""

from __future__ import annotations

import json
from typing import Any

from backend.agent.tools.base import ToolExecutionContext
from backend.agent.types import GuardrailResult, JSONDict, ToolExecutionResult


class CardExistenceGuard:
    """POST-guard: verify card IDs in tool results exist in the knowledge graph."""

    @property
    def name(self) -> str:
        return "card_existence"

    @property
    def applies_to(self) -> tuple[str, ...]:
        return (
            "build_deck_shell",
            "suggest_card_swap",
            "recommend_meta_cards",
            "find_synergies",
            "find_counters",
        )

    async def check_pre(self, tool_name: str, arguments: JSONDict, ctx: Any) -> GuardrailResult:
        return GuardrailResult(passed=True)

    async def check_post(
        self, tool_name: str, arguments: JSONDict, result: ToolExecutionResult, ctx: Any
    ) -> GuardrailResult:
        if not result.ok:
            return GuardrailResult(passed=True)

        try:
            data = json.loads(result.content)
        except (json.JSONDecodeError, TypeError):
            return GuardrailResult(passed=True)

        # Extract card IDs from various result formats
        card_ids = _extract_card_ids(tool_name, data)
        if not card_ids:
            return GuardrailResult(passed=True)

        # Batch verify against Neo4j
        if not isinstance(ctx, ToolExecutionContext):
            return GuardrailResult(passed=True)

        try:
            async with ctx.driver.session() as session:
                result_r = await session.run(
                    "UNWIND $ids AS id MATCH (c:Card {id: id}) RETURN c.id AS id",
                    ids=list(card_ids),
                )
                existing = {r["id"] async for r in result_r}

            missing = card_ids - existing
            if missing:
                return GuardrailResult(
                    passed=False,
                    violations=(
                        f"Card IDs not found in knowledge graph: {', '.join(sorted(missing))}",
                    ),
                )
        except Exception:
            # If we can't verify, don't block
            return GuardrailResult(passed=True)

        return GuardrailResult(passed=True)


def _extract_card_ids(tool_name: str, data: dict) -> set[str]:
    """Extract card IDs from various tool result formats."""
    ids: set[str] = set()

    if tool_name == "build_deck_shell":
        for card in data.get("cards", []):
            if cid := card.get("id"):
                ids.add(cid)

    elif tool_name == "suggest_card_swap":
        if cid := data.get("add_id"):
            ids.add(cid)
        if cid := data.get("remove_id"):
            ids.add(cid)

    elif tool_name == "recommend_meta_cards":
        for card in data.get("recommended_cards", []):
            if cid := card.get("id"):
                ids.add(cid)

    elif tool_name in ("find_synergies", "find_counters"):
        for partner in data.get("partners", []):
            if cid := partner.get("id"):
                ids.add(cid)
        for counter in data.get("counters", []):
            card = counter.get("card", {})
            if cid := card.get("id"):
                ids.add(cid)

    return ids
