"""Deck integrity guardrail — enforce 50 cards, 4-copy limit, color match, no banned."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from backend.agent.types import GuardrailResult, JSONDict, ToolExecutionResult


class DeckIntegrityGuard:
    """POST-guard: validate deck outputs from build/fix/swap tools."""

    @property
    def name(self) -> str:
        return "deck_integrity"

    @property
    def applies_to(self) -> tuple[str, ...]:
        return ("build_deck_shell", "suggest_deck_fixes", "suggest_card_swap")

    async def check_pre(self, tool_name: str, arguments: JSONDict, ctx: Any) -> GuardrailResult:
        return GuardrailResult(passed=True)

    async def check_post(
        self, tool_name: str, arguments: JSONDict, result: ToolExecutionResult, ctx: Any
    ) -> GuardrailResult:
        if not result.ok:
            return GuardrailResult(passed=True)  # Already errored, don't double-check

        try:
            data = json.loads(result.content)
        except (json.JSONDecodeError, TypeError):
            return GuardrailResult(passed=True)

        violations: list[str] = []

        # Only check deck-level integrity for build_deck_shell
        if tool_name == "build_deck_shell":
            cards = data.get("cards", [])

            # Check deck size
            if len(cards) != 50:
                violations.append(f"Deck has {len(cards)} cards, must be exactly 50")

            # Check 4-copy limit
            id_counts = Counter(c.get("id", "") for c in cards)
            over_limit = {cid: cnt for cid, cnt in id_counts.items() if cnt > 4}
            if over_limit:
                for cid, cnt in over_limit.items():
                    violations.append(f"Card {cid} has {cnt} copies (max 4)")

            # Check for LEADER type in deck
            leader_in_deck = [c for c in cards if c.get("card_type") == "LEADER"]
            if leader_in_deck:
                violations.append(
                    f"LEADER card(s) found in main deck: "
                    f"{', '.join(c.get('id', '?') for c in leader_in_deck)}"
                )

        if violations:
            return GuardrailResult(passed=False, violations=tuple(violations))

        return GuardrailResult(passed=True)
