"""Generate smart replacement suggestions for deck issues.

For each FAIL/WARNING from the validator, finds the best replacement card
from the graph database matching the constraint (same cost, correct color,
better counter, fills missing role, etc.)
"""

import logging
from collections import Counter

from neo4j import AsyncDriver

from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck

logger = logging.getLogger(__name__)


async def suggest_fixes(
    driver: AsyncDriver,
    leader_id: str,
    card_ids: list[str],
) -> dict:
    """Generate suggestions to fix deck validation issues.

    Returns:
        {"suggestions": [{"type", "check_name", "remove", "add", "priority"}, ...]}
    """
    # Validate
    leader = await get_card_by_id(driver, leader_id)
    if leader is None:
        return {"error": f"Leader {leader_id} not found", "suggestions": []}

    leader_colors = set(leader.get("colors", []))

    cards = []
    for cid in card_ids:
        card = await get_card_by_id(driver, cid)
        if card:
            cards.append(card)

    report = validate_deck(leader, cards)
    suggestions: list[dict] = []

    # Get candidate pool for replacements
    replacements_pool = await _get_replacement_pool(driver, leader_colors, set(card_ids))

    deck_ids = Counter(card_ids)

    # === RULE FIXES (priority: high) ===

    for check in report.fails:
        if check.name == "COLOR_MATCH" and check.details.get("violations"):
            for v in check.details["violations"]:
                replacement = _find_replacement(
                    replacements_pool,
                    target_cost=None,  # Any cost OK for color fix
                    prefer_counter=True,
                    exclude_ids=set(deck_ids.keys()),
                )
                if replacement:
                    suggestions.append({
                        "type": "rule_fix",
                        "check_name": "COLOR_MATCH",
                        "remove": {
                            "id": v["id"],
                            "name": v.get("name", ""),
                            "reason": f"Color {v.get('card_colors', [])} doesn't match leader {list(leader_colors)}",
                        },
                        "add": {
                            "id": replacement["id"],
                            "name": replacement.get("name", ""),
                            "cost": replacement.get("cost"),
                            "counter": replacement.get("counter"),
                            "benefit": _describe_card(replacement),
                        },
                        "priority": "high",
                    })

        elif check.name == "COPY_LIMIT" and check.details.get("violations"):
            for cid, count in check.details["violations"].items():
                excess = count - 4
                card_data = next((c for c in cards if c["id"] == cid), None)
                for _ in range(excess):
                    replacement = _find_replacement(
                        replacements_pool,
                        target_cost=card_data.get("cost") if card_data else None,
                        prefer_counter=True,
                        exclude_ids=set(deck_ids.keys()),
                    )
                    if replacement:
                        suggestions.append({
                            "type": "rule_fix",
                            "check_name": "COPY_LIMIT",
                            "remove": {
                                "id": cid,
                                "name": card_data.get("name", "") if card_data else cid,
                                "reason": f"Exceeds 4-copy limit ({count} copies)",
                            },
                            "add": {
                                "id": replacement["id"],
                                "name": replacement.get("name", ""),
                                "cost": replacement.get("cost"),
                                "counter": replacement.get("counter"),
                                "benefit": _describe_card(replacement),
                            },
                            "priority": "high",
                        })

        elif check.name == "NO_LEADER_IN_DECK" and check.details.get("leaders"):
            for lid in check.details["leaders"]:
                leader_card = next((c for c in cards if c["id"] == lid), None)
                replacement = _find_replacement(
                    replacements_pool,
                    target_cost=leader_card.get("cost") if leader_card else 5,
                    prefer_counter=True,
                    exclude_ids=set(deck_ids.keys()),
                )
                if replacement:
                    suggestions.append({
                        "type": "rule_fix",
                        "check_name": "NO_LEADER_IN_DECK",
                        "remove": {
                            "id": lid,
                            "name": leader_card.get("name", "") if leader_card else lid,
                            "reason": "LEADER cards cannot be in the main deck",
                        },
                        "add": {
                            "id": replacement["id"],
                            "name": replacement.get("name", ""),
                            "cost": replacement.get("cost"),
                            "counter": replacement.get("counter"),
                            "benefit": _describe_card(replacement),
                        },
                        "priority": "high",
                    })

    # === QUALITY IMPROVEMENTS (priority: medium/low) ===

    for check in report.warnings:
        if check.name == "COUNTER_DENSITY":
            # Find 0-counter cards in deck, suggest swapping for counter cards
            zero_counter = [c for c in cards if (c.get("counter") or 0) == 0 and c.get("card_type") == "CHARACTER"]
            zero_counter.sort(key=lambda c: c.get("cost") or 0)
            for card in zero_counter[:3]:  # Suggest up to 3 swaps
                replacement = _find_replacement(
                    replacements_pool,
                    target_cost=card.get("cost"),
                    prefer_counter=True,
                    min_counter=1000,
                    exclude_ids=set(deck_ids.keys()),
                )
                if replacement and (replacement.get("counter") or 0) > (card.get("counter") or 0):
                    suggestions.append({
                        "type": "quality_improvement",
                        "check_name": "COUNTER_DENSITY",
                        "remove": {
                            "id": card["id"],
                            "name": card.get("name", ""),
                            "reason": f"0 counter value (cost {card.get('cost')})",
                        },
                        "add": {
                            "id": replacement["id"],
                            "name": replacement.get("name", ""),
                            "cost": replacement.get("cost"),
                            "counter": replacement.get("counter"),
                            "benefit": _describe_card(replacement),
                        },
                        "priority": "medium",
                    })

        elif check.name == "FOUR_COPY_CORE":
            # Find 3x cards → suggest promoting to 4x by removing a 1x card
            three_copy = [cid for cid, cnt in deck_ids.items() if cnt == 3]
            one_copy = [cid for cid, cnt in deck_ids.items() if cnt == 1]
            one_copy_cards = [c for c in cards if c["id"] in one_copy]
            # Sort 1x cards by lowest impact (low relevance / low counter)
            one_copy_cards.sort(key=lambda c: (c.get("counter") or 0))

            for promote_id in three_copy[:3]:
                if not one_copy_cards:
                    break
                remove_card = one_copy_cards.pop(0)
                promote_card = next((c for c in cards if c["id"] == promote_id), None)
                if promote_card:
                    suggestions.append({
                        "type": "quality_improvement",
                        "check_name": "FOUR_COPY_CORE",
                        "remove": {
                            "id": remove_card["id"],
                            "name": remove_card.get("name", ""),
                            "reason": f"1x card — low consistency, cost {remove_card.get('cost')}",
                        },
                        "add": {
                            "id": promote_card["id"],
                            "name": promote_card.get("name", ""),
                            "cost": promote_card.get("cost"),
                            "counter": promote_card.get("counter"),
                            "benefit": f"Promote to 4x for consistency ({promote_card.get('name')})",
                        },
                        "priority": "medium",
                    })

        elif check.name == "BLOCKER_COUNT":
            # Add blockers
            replacement = _find_replacement(
                replacements_pool,
                target_cost=None,
                prefer_counter=True,
                required_keyword="Blocker",
                exclude_ids=set(deck_ids.keys()),
            )
            weakest = _find_weakest_card(cards, deck_ids, exclude_roles={"Blocker"})
            if replacement and weakest:
                suggestions.append({
                    "type": "quality_improvement",
                    "check_name": "BLOCKER_COUNT",
                    "remove": {
                        "id": weakest["id"],
                        "name": weakest.get("name", ""),
                        "reason": f"No key role, cost {weakest.get('cost')}",
                    },
                    "add": {
                        "id": replacement["id"],
                        "name": replacement.get("name", ""),
                        "cost": replacement.get("cost"),
                        "counter": replacement.get("counter"),
                        "benefit": _describe_card(replacement),
                    },
                    "priority": "low",
                })

        elif check.name == "WIN_CONDITION":
            replacement = _find_replacement(
                replacements_pool,
                target_cost=None,
                prefer_counter=False,
                min_cost=7,
                min_power=7000,
                exclude_ids=set(deck_ids.keys()),
            )
            weakest = _find_weakest_card(cards, deck_ids)
            if replacement and weakest:
                suggestions.append({
                    "type": "quality_improvement",
                    "check_name": "WIN_CONDITION",
                    "remove": {
                        "id": weakest["id"],
                        "name": weakest.get("name", ""),
                        "reason": f"Low impact card, cost {weakest.get('cost')}",
                    },
                    "add": {
                        "id": replacement["id"],
                        "name": replacement.get("name", ""),
                        "cost": replacement.get("cost"),
                        "counter": replacement.get("counter"),
                        "benefit": _describe_card(replacement),
                    },
                    "priority": "low",
                })

    # Sort: rule_fix first, then by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    suggestions.sort(key=lambda s: (0 if s["type"] == "rule_fix" else 1, priority_order.get(s["priority"], 9)))

    return {"suggestions": suggestions, "validation": report.to_dict()}


async def _get_replacement_pool(driver: AsyncDriver, leader_colors: set[str], exclude_ids: set[str]) -> list[dict]:
    """Get pool of valid replacement cards matching leader colors."""
    color_list = list(leader_colors)

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
            WHERE color.name IN $colors
              AND c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            WITH c, collect(DISTINCT k.name) AS keywords, collect(DISTINCT color.name) AS colors
            RETURN c, keywords, colors
            ORDER BY c.counter DESC, c.cost ASC
            """,
            colors=color_list,
        )
        pool = []
        seen = set()
        async for record in result:
            card = dict(record["c"])
            card["keywords"] = record["keywords"]
            card["colors"] = record["colors"]
            if card["id"] not in seen and card["id"] not in exclude_ids:
                pool.append(card)
                seen.add(card["id"])

    return pool


def _find_replacement(
    pool: list[dict],
    target_cost: int | None = None,
    prefer_counter: bool = True,
    min_counter: int = 0,
    min_cost: int | None = None,
    min_power: int | None = None,
    required_keyword: str | None = None,
    exclude_ids: set[str] | None = None,
) -> dict | None:
    """Find the best replacement card from pool matching criteria."""
    candidates = pool
    if exclude_ids:
        candidates = [c for c in candidates if c["id"] not in exclude_ids]
    if min_counter:
        candidates = [c for c in candidates if (c.get("counter") or 0) >= min_counter]
    if min_cost is not None:
        candidates = [c for c in candidates if (c.get("cost") or 0) >= min_cost]
    if min_power is not None:
        candidates = [c for c in candidates if (c.get("power") or 0) >= min_power]
    if required_keyword:
        candidates = [c for c in candidates if required_keyword in (c.get("keywords") or [])]

    if not candidates:
        return None

    # Sort by best match
    def score(c):
        s = 0.0
        if target_cost is not None:
            cost_diff = abs((c.get("cost") or 0) - target_cost)
            s -= cost_diff * 2  # Prefer same cost
        if prefer_counter:
            s += (c.get("counter") or 0) / 1000
        s += len(c.get("keywords") or []) * 0.3
        return s

    candidates.sort(key=lambda c: -score(c))
    return candidates[0]


def _find_weakest_card(
    cards: list[dict],
    deck_ids: Counter,
    exclude_roles: set[str] | None = None,
) -> dict | None:
    """Find the weakest card in deck (low counter, few keywords, 1x copy)."""
    scored = []
    for card in cards:
        keywords = set(card.get("keywords") or [])
        # Skip if card fills an important role we want to keep
        if exclude_roles:
            has_excluded = False
            role_map = {"Blocker": {"Blocker"}, "Rush": {"Rush"}, "Draw": {"Draw", "Search"}, "Removal": {"KO", "Bounce", "Trash"}}
            for role in exclude_roles:
                if keywords & role_map.get(role, set()):
                    has_excluded = True
                    break
            if has_excluded:
                continue

        # Lower score = weaker card
        score = (card.get("counter") or 0) / 1000
        score += len(keywords) * 0.5
        score += (1 if deck_ids[card["id"]] > 1 else 0)  # Prefer removing 1x cards
        scored.append((score, card))

    if not scored:
        return None
    scored.sort(key=lambda x: x[0])
    return scored[0][1]


def _describe_card(card: dict) -> str:
    """Generate a short benefit description for a replacement card."""
    parts = []
    if card.get("card_type"):
        parts.append(card["card_type"])
    if card.get("cost") is not None:
        parts.append(f"cost {card['cost']}")
    if card.get("counter") and card["counter"] > 0:
        parts.append(f"{card['counter']} counter")
    if card.get("power"):
        parts.append(f"{card['power']} power")
    keywords = card.get("keywords") or []
    if keywords:
        parts.append(", ".join(keywords[:3]))
    return " | ".join(parts)
