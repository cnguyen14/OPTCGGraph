"""OPTCG Deck Building Engine — builds legal, competitive decks for any leader.

Rules enforced:
- Exactly 50 cards (not counting Leader)
- Max 4 copies of any card
- All cards match Leader's color(s)
- No LEADER cards in deck

Quality targets based on pro tournament data:
- Balanced cost curve by strategy (aggro/midrange/control)
- Sufficient counter density (avg 800+ per card)
- Role coverage: blockers, removal, draw/search, finishers
- Character-heavy composition (~77%)
"""

import logging
from collections import Counter

from neo4j import AsyncDriver

from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck

logger = logging.getLogger(__name__)

# Strategy templates: target card counts per role/cost
STRATEGY_TEMPLATES = {
    "aggro": {
        "cost_targets": {(0, 2): (14, 18), (3, 5): (18, 22), (6, 9): (8, 10), (10, 99): (0, 2)},
        "role_targets": {"blockers": 4, "removal": 4, "draw_search": 4, "rush": 6, "finishers": 2},
        "type_targets": {"CHARACTER": (38, 42), "EVENT": (6, 10), "STAGE": (0, 2)},
    },
    "midrange": {
        "cost_targets": {(0, 2): (10, 14), (3, 5): (18, 22), (6, 9): (10, 14), (10, 99): (0, 2)},
        "role_targets": {"blockers": 6, "removal": 6, "draw_search": 6, "rush": 4, "finishers": 4},
        "type_targets": {"CHARACTER": (36, 40), "EVENT": (8, 12), "STAGE": (0, 4)},
    },
    "control": {
        "cost_targets": {(0, 2): (8, 10), (3, 5): (16, 20), (6, 9): (14, 18), (10, 99): (2, 4)},
        "role_targets": {"blockers": 8, "removal": 8, "draw_search": 8, "rush": 2, "finishers": 6},
        "type_targets": {"CHARACTER": (32, 38), "EVENT": (10, 16), "STAGE": (2, 4)},
    },
}

ROLE_KEYWORDS = {
    "blockers": ["Blocker"],
    "removal": ["KO", "Bounce", "Trash", "Power Debuff", "Rest"],
    "draw_search": ["Draw", "Search"],
    "rush": ["Rush"],
}


async def build_deck(
    driver: AsyncDriver,
    leader_id: str,
    strategy: str = "midrange",
    budget_max: float | None = None,
) -> dict:
    """Build a legal, competitive deck for any leader.

    Returns dict with: leader, cards (list of 50), validation, curve, summary.
    """
    # 1. Resolve leader
    leader = await get_card_by_id(driver, leader_id)
    if leader is None:
        return {"error": f"Leader {leader_id} not found"}
    if leader.get("card_type") != "LEADER":
        return {"error": f"{leader_id} is not a LEADER card"}

    leader_colors = set(leader.get("colors", []))
    if not leader_colors:
        return {"error": f"Leader {leader_id} has no colors"}

    strategy = strategy if strategy in STRATEGY_TEMPLATES else "midrange"
    template = STRATEGY_TEMPLATES[strategy]

    # 2. Get ALL eligible candidates from Neo4j
    candidates = await _get_candidates(driver, leader_id, leader_colors)
    if not candidates:
        return {"error": f"No eligible cards found for leader {leader_id} colors {leader_colors}"}

    logger.info(f"Found {len(candidates)} candidates for {leader_id} ({strategy})")

    # 3. Categorize candidates by role
    categorized = _categorize(candidates)

    # 4. Build deck using strategy template
    deck = _fill_deck(candidates, categorized, template, budget_max)

    # 5. Validate and self-correct
    report = validate_deck(leader, deck)
    if not report.is_legal:
        logger.warning(f"Deck failed validation, attempting self-correction...")
        deck = _fix_violations(deck, report, candidates, leader_colors)
        report = validate_deck(leader, deck)

    # 6. Build summary
    curve = Counter(c.get("cost", 0) for c in deck if c.get("cost") is not None)
    type_counts = Counter(c.get("card_type", "") for c in deck)
    id_counts = Counter(c["id"] for c in deck)
    total_price = sum(c.get("market_price") or 0 for c in deck)

    return {
        "leader": {
            "id": leader["id"],
            "name": leader["name"],
            "colors": leader.get("colors", []),
            "families": leader.get("families", []),
            "ability": leader.get("ability", ""),
        },
        "cards": [
            {"id": c["id"], "name": c.get("name", ""), "cost": c.get("cost"),
             "power": c.get("power"), "counter": c.get("counter"),
             "card_type": c.get("card_type", ""), "keywords": c.get("keywords", []),
             "market_price": c.get("market_price")}
            for c in deck
        ],
        "total_cards": len(deck),
        "total_price": round(total_price, 2),
        "strategy": strategy,
        "curve": dict(sorted(curve.items())),
        "type_distribution": dict(type_counts),
        "unique_cards": len(id_counts),
        "four_copy_cards": [cid for cid, cnt in id_counts.items() if cnt == 4],
        "validation": report.to_dict(),
    }


async def _get_candidates(driver: AsyncDriver, leader_id: str, leader_colors: set[str]) -> list[dict]:
    """Get all eligible cards: matching leader colors, non-LEADER, with synergy scoring."""
    color_list = list(leader_colors)

    async with driver.session() as session:
        # Get cards matching any of the leader's colors + not LEADER type
        # Score by: LED_BY connection, SYNERGY connection, family overlap
        result = await session.run(
            """
            MATCH (c:Card)-[:HAS_COLOR]->(color:Color)
            WHERE color.name IN $colors
              AND c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            OPTIONAL MATCH (c)-[led:LED_BY]->(:Card {id: $leader_id})
            OPTIONAL MATCH (c)-[syn:SYNERGY]-(:Card)-[:LED_BY]->(:Card {id: $leader_id})
            WITH c,
                 collect(DISTINCT k.name) AS keywords,
                 collect(DISTINCT color.name) AS colors,
                 CASE WHEN led IS NOT NULL THEN 3 ELSE 0 END AS led_score,
                 CASE WHEN syn IS NOT NULL THEN 1 ELSE 0 END AS syn_score
            RETURN c, keywords, colors, (led_score + syn_score) AS relevance
            ORDER BY relevance DESC, c.cost ASC
            """,
            colors=color_list,
            leader_id=leader_id,
        )

        candidates = []
        seen = set()
        async for record in result:
            card = dict(record["c"])
            card["keywords"] = record["keywords"]
            card["colors"] = record["colors"]
            card["relevance"] = record["relevance"]
            if card["id"] not in seen:
                candidates.append(card)
                seen.add(card["id"])

    return candidates


def _categorize(candidates: list[dict]) -> dict[str, list[dict]]:
    """Categorize candidates by gameplay role based on keywords and stats."""
    buckets: dict[str, list[dict]] = {
        "blockers": [], "removal": [], "draw_search": [], "rush": [],
        "finishers": [], "counter_cards": [], "characters": [], "events": [], "stages": [],
    }

    for card in candidates:
        keywords = set(card.get("keywords", []))
        card_type = card.get("card_type", "")
        cost = card.get("cost") or 0
        power = card.get("power") or 0
        counter = card.get("counter") or 0

        # Type buckets
        if card_type == "CHARACTER":
            buckets["characters"].append(card)
        elif card_type == "EVENT":
            buckets["events"].append(card)
        elif card_type == "STAGE":
            buckets["stages"].append(card)

        # Role buckets (a card can be in multiple)
        for role, kws in ROLE_KEYWORDS.items():
            if keywords & set(kws):
                buckets[role].append(card)

        if cost >= 7 and power >= 7000:
            buckets["finishers"].append(card)

        if counter >= 1000:
            buckets["counter_cards"].append(card)

    return buckets


def _score_card(card: dict) -> float:
    """Score a card for core selection: relevance + counter bonus + role coverage."""
    score = card.get("relevance", 0) * 2.0
    counter = card.get("counter") or 0
    if counter >= 2000:
        score += 2.0
    elif counter >= 1000:
        score += 1.0
    keywords = set(card.get("keywords", []))
    roles_covered = sum(1 for kws in ROLE_KEYWORDS.values() if keywords & set(kws))
    score += roles_covered * 0.5
    return score


def _fill_deck(
    candidates: list[dict],
    categorized: dict[str, list[dict]],
    template: dict,
    budget_max: float | None,
) -> list[dict]:
    """Fill a 50-card deck with 4x core consistency, balanced curve, and counter density."""
    deck: list[dict] = []
    deck_ids: Counter = Counter()
    total_price = 0.0

    def can_add(card: dict) -> bool:
        if deck_ids[card["id"]] >= 4:
            return False
        if card.get("card_type") == "LEADER":
            return False
        if budget_max:
            price = card.get("market_price") or 0
            if total_price + price > budget_max:
                return False
        return True

    def add_card(card: dict, copies: int = 1) -> int:
        nonlocal total_price
        added = 0
        for _ in range(copies):
            if len(deck) >= 50 or not can_add(card):
                break
            deck.append(card)
            deck_ids[card["id"]] += 1
            total_price += card.get("market_price") or 0
            added += 1
        return added

    cost_targets = template["cost_targets"]

    # === Phase 0: Select CORE cards (4x copies each) ===
    # Pick best cards per cost tier, add 4 copies → builds consistent 32-40 card base
    for (cost_min, cost_max), (target_min, _target_max) in cost_targets.items():
        # How many 4x playsets for this tier
        core_sets = max(1, target_min // 4)

        pool = [c for c in candidates
                if cost_min <= (c.get("cost") or 0) <= cost_max
                and c.get("card_type") != "LEADER"]
        pool.sort(key=lambda c: -_score_card(c))

        selected = 0
        for card in pool:
            if selected >= core_sets or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0:  # Not yet in deck
                added = add_card(card, copies=4)
                if added > 0:
                    selected += 1

    # === Phase 1: Fill ROLE gaps ===
    # Check which roles are under-target after core fill, add specialists
    role_targets = template["role_targets"]
    for role, target_count in role_targets.items():
        # Count how many cards already fill this role
        current_role = sum(
            1 for c in deck
            if set(c.get("keywords", [])) & set(ROLE_KEYWORDS.get(role, []))
        )
        if current_role >= target_count:
            continue

        needed = target_count - current_role
        pool = sorted(categorized.get(role, []), key=lambda c: -_score_card(c))
        for card in pool:
            if needed <= 0 or len(deck) >= 50:
                break
            if deck_ids[card["id"]] == 0:  # Prefer new cards for diversity
                added = add_card(card, copies=min(2, needed))
                needed -= added

    # === Phase 2: Fill COST CURVE gaps ===
    for (cost_min, cost_max), (target_min, _target_max) in cost_targets.items():
        current = sum(1 for c in deck if cost_min <= (c.get("cost") or 0) <= cost_max)
        if current >= target_min:
            continue
        needed = target_min - current
        pool = [c for c in candidates
                if cost_min <= (c.get("cost") or 0) <= cost_max
                and c.get("card_type") != "LEADER"]
        # Prefer high counter for density improvement
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -_score_card(c)))
        for card in pool:
            if needed <= 0 or len(deck) >= 50:
                break
            if can_add(card):
                added = add_card(card, copies=min(2, needed))
                needed -= added

    # === Phase 3: Fill remaining with counter-dense cards ===
    if len(deck) < 50:
        pool = [c for c in candidates if can_add(c) and (c.get("counter") or 0) >= 1000]
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -_score_card(c)))
        for card in pool:
            if len(deck) >= 50:
                break
            add_card(card)

    # === Phase 4: Pad to 50 with extra copies of best cards ===
    if len(deck) < 50:
        # Add copies of existing deck cards sorted by score
        existing = sorted(set(c["id"] for c in deck),
                          key=lambda cid: -max(_score_card(c) for c in deck if c["id"] == cid))
        for cid in existing:
            if len(deck) >= 50:
                break
            card = next(c for c in deck if c["id"] == cid)
            while len(deck) < 50 and deck_ids[cid] < 4:
                add_card(card)

    # === Phase 5: Last resort — any valid candidate ===
    if len(deck) < 50:
        for card in candidates:
            if len(deck) >= 50:
                break
            if can_add(card):
                add_card(card)

    return deck[:50]


def _fix_violations(
    deck: list[dict],
    report,
    candidates: list[dict],
    leader_colors: set[str],
) -> list[dict]:
    """Fix rule violations by swapping illegal cards with valid alternatives."""
    fixed = list(deck)
    deck_ids = Counter(c["id"] for c in fixed)

    # Fix: remove LEADER cards
    fixed = [c for c in fixed if c.get("card_type") != "LEADER"]

    # Fix: remove wrong-color cards
    fixed = [c for c in fixed if set(c.get("colors", [])) & leader_colors]

    # Fix: enforce max 4 copies
    final = []
    copy_count: Counter = Counter()
    for card in fixed:
        if copy_count[card["id"]] < 4:
            final.append(card)
            copy_count[card["id"]] += 1
    fixed = final

    # Pad back to 50 from candidates
    if len(fixed) < 50:
        used = Counter(c["id"] for c in fixed)
        pool = [c for c in candidates
                if c.get("card_type") != "LEADER"
                and set(c.get("colors", [])) & leader_colors
                and used[c["id"]] < 4]
        pool.sort(key=lambda c: (-(c.get("counter") or 0), -c.get("relevance", 0)))
        for card in pool:
            if len(fixed) >= 50:
                break
            if used[card["id"]] < 4:
                fixed.append(card)
                used[card["id"]] += 1

    return fixed[:50]
