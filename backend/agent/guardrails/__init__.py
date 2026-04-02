"""Guardrails — tool execution middleware for safety and validation."""

from __future__ import annotations

from backend.agent.guardrails.base import Guardrail, GuardrailResult, run_guards
from backend.agent.guardrails.card_existence import CardExistenceGuard
from backend.agent.guardrails.cypher_safety import CypherSafetyGuard
from backend.agent.guardrails.deck_integrity import DeckIntegrityGuard
from backend.agent.guardrails.output_limits import OutputLimitsGuard

__all__ = [
    "Guardrail",
    "GuardrailResult",
    "run_guards",
    "build_default_guards",
]


def build_default_guards() -> list[Guardrail]:
    """Return the default set of guardrails."""
    return [
        CypherSafetyGuard(),
        DeckIntegrityGuard(),
        CardExistenceGuard(),
        OutputLimitsGuard(),
    ]
