"""Parse keywords and ability text into EffectTemplate objects.

Bridges the existing keyword data from Neo4j with the new template-based
effect system. Uses pattern matching on ability text to extract parameters
(power thresholds, target counts, draw amounts, etc.) that the old keyword
system ignored.
"""

from __future__ import annotations

import re

from .models import (
    EffectCondition,
    EffectTemplate,
    EffectTrigger,
    EffectType,
)


def parse_effects(
    keywords: list[str],
    ability_text: str,
    trigger_effect: str,
    card_type: str,
    cost: int,
) -> list[EffectTemplate]:
    """Convert keywords + ability text into a list of EffectTemplates.

    This combines:
    1. Keyword-based defaults (backward compatible with old system)
    2. Ability text parsing for parameterized details
    3. Trigger effect parsing for life card triggers
    """
    effects: list[EffectTemplate] = []
    kw_lower = {k.lower() for k in keywords}
    ability = ability_text.lower() if ability_text else ""
    condition: EffectCondition | None = None  # Reused across effect blocks

    # --- Passive / static abilities ---

    if "blocker" in kw_lower:
        effects.append(
            EffectTemplate(type=EffectType.BLOCKER, trigger=EffectTrigger.PASSIVE)
        )

    if "rush" in kw_lower:
        effects.append(
            EffectTemplate(type=EffectType.RUSH, trigger=EffectTrigger.PASSIVE)
        )

    if "double attack" in kw_lower:
        effects.append(
            EffectTemplate(type=EffectType.DOUBLE_ATTACK, trigger=EffectTrigger.PASSIVE)
        )

    if "banish" in kw_lower:
        effects.append(
            EffectTemplate(type=EffectType.BANISH, trigger=EffectTrigger.PASSIVE)
        )

    # --- Determine trigger from ability text ---

    trigger = _detect_trigger(ability, card_type)

    # --- KO effect ---

    if "ko" in kw_lower:
        condition = _parse_ko_condition(ability, cost)
        effects.append(
            EffectTemplate(
                type=EffectType.KO,
                trigger=trigger,
                target="opponent_character",
                condition=condition,
                count=1,
            )
        )

    # --- Bounce effect ---

    if "bounce" in kw_lower:
        condition = _parse_bounce_condition(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.BOUNCE,
                trigger=trigger,
                target="opponent_character",
                condition=condition,
                count=1,
            )
        )

    # --- Draw effect ---

    if "draw" in kw_lower:
        amount = _parse_draw_amount(ability)
        if card_type == "LEADER":
            effects.append(
                EffectTemplate(
                    type=EffectType.DRAW,
                    trigger=EffectTrigger.ON_ATTACK,
                    amount=amount,
                )
            )
        else:
            effects.append(
                EffectTemplate(type=EffectType.DRAW, trigger=trigger, amount=amount)
            )

    # --- Search effect ---

    if "search" in kw_lower:
        condition = _parse_search_condition(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.SEARCH,
                trigger=trigger,
                target="own_deck",
                condition=condition,
                amount=5,  # Look at top 5 by default
            )
        )

    # --- Trash from hand ---

    if "trash" in kw_lower:
        amount = _parse_trash_amount(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.TRASH_FROM_HAND,
                trigger=trigger,
                target="opponent_hand",
                count=amount,
            )
        )

    # --- Rest ---

    if "rest" in kw_lower:
        count = _parse_rest_count(ability)
        condition = _parse_rest_condition(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.REST,
                trigger=trigger,
                target="opponent_character",
                condition=condition,
                count=count,
            )
        )

    # --- Power buff / debuff ---

    if "buff" in kw_lower or "power buff" in kw_lower:
        amount = _parse_power_amount(ability, default=2000)
        effects.append(
            EffectTemplate(
                type=EffectType.POWER_BOOST,
                trigger=trigger,
                target="self",
                amount=amount,
            )
        )

    if "debuff" in kw_lower or "power debuff" in kw_lower:
        amount = _parse_power_amount(ability, default=2000, is_debuff=True)
        effects.append(
            EffectTemplate(
                type=EffectType.POWER_REDUCE,
                trigger=trigger,
                target="opponent_character",
                amount=amount,
            )
        )

    # --- Bottom deck (stronger bounce) ---

    if _has_bottom_deck(ability):
        condition = _parse_ko_condition(ability, cost)
        effects.append(
            EffectTemplate(
                type=EffectType.BOTTOM_DECK,
                trigger=trigger,
                target="opponent_character",
                condition=condition,
                count=1,
            )
        )

    # --- Play from trash ---

    if _has_play_from_trash(ability):
        condition = _parse_play_from_trash_condition(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.PLAY_FROM_TRASH,
                trigger=trigger,
                target="own_trash",
                condition=condition,
                count=1,
            )
        )

    # --- DON minus ---

    if _has_don_minus(ability):
        amount = _parse_don_minus_amount(ability)
        effects.append(
            EffectTemplate(
                type=EffectType.DON_MINUS,
                trigger=trigger,
                target="opponent",
                amount=amount,
            )
        )

    # --- Trigger effects (life card) ---

    if trigger_effect:
        trigger_templates = _parse_trigger_effect(trigger_effect, cost)
        effects.extend(trigger_templates)

    return effects


# ---------------------------------------------------------------------------
# Trigger detection
# ---------------------------------------------------------------------------


def _detect_trigger(ability: str, card_type: str) -> EffectTrigger:
    """Detect the most likely trigger from ability text."""
    if "when attacking" in ability:
        return EffectTrigger.ON_ATTACK
    if (
        "when this character is k.o" in ability
        or "when this character is ko" in ability
    ):
        return EffectTrigger.ON_KO
    if "when blocking" in ability:
        return EffectTrigger.ON_BLOCK
    if card_type == "STAGE":
        return EffectTrigger.PASSIVE
    return EffectTrigger.ON_PLAY


# ---------------------------------------------------------------------------
# KO condition parsing
# ---------------------------------------------------------------------------


def _parse_ko_condition(ability: str, source_cost: int) -> EffectCondition:
    """Parse KO target conditions from ability text."""
    # "K.O. 1 of your opponent's Characters with 5000 or less power"
    m = re.search(r"(\d+)\s*(?:000)?\s*or\s*less\s*power", ability)
    if m:
        value = int(m.group(1))
        if value < 100:
            value *= 1000
        return EffectCondition(power_lte=value)

    # "K.O. 1 of your opponent's Characters with a cost of 3 or less"
    m = re.search(r"cost\s*(?:of\s*)?(\d+)\s*or\s*less", ability)
    if m:
        return EffectCondition(cost_lte=int(m.group(1)))

    # Default: power <= source_cost * 1000
    return EffectCondition(source_cost_multiplier=1000)


# ---------------------------------------------------------------------------
# Bounce condition parsing
# ---------------------------------------------------------------------------


def _parse_bounce_condition(ability: str) -> EffectCondition | None:
    """Parse bounce target conditions."""
    # "Return 1 Character with a cost of 3 or less to the owner's hand"
    m = re.search(r"cost\s*(?:of\s*)?(\d+)\s*or\s*less", ability)
    if m:
        return EffectCondition(cost_lte=int(m.group(1)))

    # "Return 1 Character with 5000 or less power"
    m = re.search(r"(\d+)\s*(?:000)?\s*or\s*less\s*power", ability)
    if m:
        value = int(m.group(1))
        if value < 100:
            value *= 1000
        return EffectCondition(power_lte=value)

    return None  # No condition — bounce lowest


# ---------------------------------------------------------------------------
# Draw amount parsing
# ---------------------------------------------------------------------------


def _parse_draw_amount(ability: str) -> int:
    """Parse how many cards to draw."""
    m = re.search(r"draw\s+(\d+)\s+card", ability)
    if m:
        return int(m.group(1))
    return 1


# ---------------------------------------------------------------------------
# Search condition parsing
# ---------------------------------------------------------------------------


def _parse_search_condition(ability: str) -> EffectCondition | None:
    """Parse search target conditions (what card to add from top 5)."""
    # "add 1 {Color} card with a cost of 5 or less"
    m = re.search(r"cost\s*(?:of\s*)?(\d+)\s*or\s*less", ability)
    if m:
        return EffectCondition(cost_lte=int(m.group(1)))
    return None


# ---------------------------------------------------------------------------
# Trash/discard parsing
# ---------------------------------------------------------------------------


def _parse_trash_amount(ability: str) -> int:
    m = re.search(r"trash\s+(\d+)\s+card", ability)
    if m:
        return int(m.group(1))
    return 1


# ---------------------------------------------------------------------------
# Rest parsing
# ---------------------------------------------------------------------------


def _parse_rest_count(ability: str) -> int:
    m = re.search(r"rest\s+(?:up\s+to\s+)?(\d+)", ability)
    if m:
        return int(m.group(1))
    return 1


def _parse_rest_condition(ability: str) -> EffectCondition | None:
    m = re.search(r"rest.*cost\s*(?:of\s*)?(\d+)\s*or\s*less", ability)
    if m:
        return EffectCondition(cost_lte=int(m.group(1)))
    return None


# ---------------------------------------------------------------------------
# Power amount parsing
# ---------------------------------------------------------------------------


def _parse_power_amount(
    ability: str, default: int = 2000, *, is_debuff: bool = False
) -> int:
    """Parse power boost/reduce amount."""
    pattern = r"[-+]?\s*(\d+)\s*(?:000)?" if not is_debuff else r"-\s*(\d+)\s*(?:000)?"
    m = re.search(pattern, ability)
    if m:
        value = int(m.group(1))
        if value < 100:
            value *= 1000
        return value
    return default


# ---------------------------------------------------------------------------
# Bottom deck detection
# ---------------------------------------------------------------------------


def _has_bottom_deck(ability: str) -> bool:
    return "bottom of" in ability and ("deck" in ability)


# ---------------------------------------------------------------------------
# Play from trash detection
# ---------------------------------------------------------------------------


def _has_play_from_trash(ability: str) -> bool:
    return ("play" in ability and "trash" in ability) or "from your trash" in ability


def _parse_play_from_trash_condition(ability: str) -> EffectCondition | None:
    m = re.search(r"cost\s*(?:of\s*)?(\d+)\s*or\s*less", ability)
    if m:
        return EffectCondition(cost_lte=int(m.group(1)))
    return None


# ---------------------------------------------------------------------------
# DON minus detection
# ---------------------------------------------------------------------------


def _has_don_minus(ability: str) -> bool:
    return "don!!" in ability and ("-" in ability or "return" in ability)


def _parse_don_minus_amount(ability: str) -> int:
    m = re.search(r"[-−]\s*(\d+)\s*don", ability)
    if m:
        return int(m.group(1))
    return 1


# ---------------------------------------------------------------------------
# Trigger effect parsing
# ---------------------------------------------------------------------------


def _parse_trigger_effect(trigger_text: str, cost: int) -> list[EffectTemplate]:
    """Parse trigger effects (activated when taken as life damage)."""
    trigger_lower = trigger_text.lower()
    templates: list[EffectTemplate] = []

    if "draw" in trigger_lower:
        amount = 1
        m = re.search(r"draw\s+(\d+)", trigger_lower)
        if m:
            amount = int(m.group(1))
        templates.append(
            EffectTemplate(
                type=EffectType.DRAW, trigger=EffectTrigger.TRIGGER, amount=amount
            )
        )

    if "rest" in trigger_lower:
        templates.append(
            EffectTemplate(
                type=EffectType.REST,
                trigger=EffectTrigger.TRIGGER,
                target="opponent_character",
                count=1,
            )
        )

    if "play" in trigger_lower:
        condition = None
        m = re.search(r"cost\s*(?:of\s*)?(\d+)\s*or\s*less", trigger_lower)
        if m:
            condition = EffectCondition(cost_lte=int(m.group(1)))
        else:
            condition = EffectCondition(cost_lte=3)
        templates.append(
            EffectTemplate(
                type=EffectType.TRIGGER_PLAY,
                trigger=EffectTrigger.TRIGGER,
                target="own_hand",
                condition=condition,
            )
        )

    if "ko" in trigger_lower or "k.o" in trigger_lower:
        condition = EffectCondition(source_cost_multiplier=1000)
        m = re.search(r"(\d+)\s*(?:000)?\s*or\s*less\s*power", trigger_lower)
        if m:
            value = int(m.group(1))
            if value < 100:
                value *= 1000
            condition = EffectCondition(power_lte=value)
        templates.append(
            EffectTemplate(
                type=EffectType.KO,
                trigger=EffectTrigger.TRIGGER,
                target="opponent_character",
                condition=condition,
            )
        )

    return templates
