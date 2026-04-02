"""Skill router — resolve user intent to the appropriate skill."""

from __future__ import annotations

import logging

from backend.agent.skills import DEFAULT_SKILL
from backend.agent.types import SkillConfig

logger = logging.getLogger(__name__)

# Slash command → skill name mapping
_SLASH_COMMANDS: dict[str, str] = {
    "/build": "deck_builder",
    "/validate": "deck_validator",
    "/meta": "meta_analyst",
    "/optimize": "deck_optimizer",
    "/explore": "card_explorer",
    "/simulate": "game_simulator",
}


def resolve_skill(
    message: str,
    active_skill: str | None,
    skills: dict[str, SkillConfig],
) -> SkillConfig:
    """Route user intent to the best matching skill.

    Priority:
    1. Explicit slash command (/build, /validate, /meta, etc.)
    2. Trigger keyword match (highest overlap wins)
    3. Context continuity (stay in current skill if ambiguous)
    4. Fallback to card_explorer
    """
    msg_lower = message.lower().strip()

    # 1. Explicit slash command
    for cmd, skill_name in _SLASH_COMMANDS.items():
        if msg_lower.startswith(cmd):
            if skill_name in skills:
                logger.info("Skill resolved via slash command: %s", skill_name)
                return skills[skill_name]

    # 2. Keyword trigger matching
    best_skill: str | None = None
    best_score = 0

    for name, skill in skills.items():
        score = 0
        for trigger in skill.triggers:
            if trigger.lower() in msg_lower:
                # Longer triggers are more specific → higher score
                score += len(trigger)
        if score > best_score:
            best_score = score
            best_skill = name

    if best_skill and best_score > 0:
        logger.info("Skill resolved via trigger match: %s (score=%d)", best_skill, best_score)
        return skills[best_skill]

    # 3. Context continuity
    if active_skill and active_skill in skills:
        logger.info("Skill resolved via context continuity: %s", active_skill)
        return skills[active_skill]

    # 4. Fallback
    fallback = DEFAULT_SKILL if DEFAULT_SKILL in skills else next(iter(skills))
    logger.info("Skill resolved via fallback: %s", fallback)
    return skills[fallback]
