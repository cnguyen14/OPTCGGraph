"""Prompt composition — base + dynamic context + skill instructions."""

from __future__ import annotations

from backend.agent.prompts.base import get_base_prompt
from backend.agent.prompts.context import (
    get_banned_cards_section,
    get_deck_context_section,
    get_leader_context_section,
)
from backend.agent.types import DeckContext, SkillConfig


def render_system_prompt(
    skill: SkillConfig,
    deck_context: DeckContext,
    banned_cards: list[dict],
    selected_leader: str | None = None,
) -> str:
    """Compose the full system prompt: base + context + skill instructions."""
    parts = [
        get_base_prompt(),
        get_banned_cards_section(banned_cards),
        get_leader_context_section(selected_leader),
        get_deck_context_section(deck_context),
        f"# Active Skill: {skill.name}\n\n{skill.instructions}",
    ]
    return "\n\n".join(p for p in parts if p)
