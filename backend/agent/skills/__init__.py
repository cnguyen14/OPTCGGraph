"""Skill loader — discover and parse skill markdown files."""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from backend.agent.types import SkillConfig

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent
DEFAULT_SKILL = "card_explorer"


def load_skill(name: str) -> SkillConfig:
    """Load a single skill from its .md file."""
    path = SKILLS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Skill file not found: {path}")

    text = path.read_text(encoding="utf-8")

    # Split YAML frontmatter from markdown body
    # Format: ---\nyaml\n---\nmarkdown body
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError(f"Skill {name} missing YAML frontmatter (---)")

    meta = yaml.safe_load(parts[1])
    body = parts[2].strip()

    return SkillConfig(
        name=meta["name"],
        description=meta.get("description", ""),
        allowed_tools=tuple(meta.get("allowed_tools", [])),
        triggers=tuple(meta.get("triggers", [])),
        max_iterations=meta.get("max_iterations", 10),
        instructions=body,
    )


def load_all_skills() -> dict[str, SkillConfig]:
    """Discover and load all .md skill files in the skills directory."""
    skills: dict[str, SkillConfig] = {}
    for path in sorted(SKILLS_DIR.glob("*.md")):
        try:
            skill = load_skill(path.stem)
            skills[skill.name] = skill
            logger.debug("Loaded skill: %s (%d tools)", skill.name, len(skill.allowed_tools))
        except Exception as exc:
            logger.warning("Failed to load skill %s: %s", path.stem, exc)
    return skills
