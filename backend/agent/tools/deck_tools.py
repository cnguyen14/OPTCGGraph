"""Deck tools — build, validate, suggest fixes, swap."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext
from backend.graph.queries import get_card_by_id

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_build_deck_shell(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.ai.deck_builder import build_deck

    result = await build_deck(
        driver=ctx.driver,
        leader_id=args["leader_id"],
        strategy=args.get("strategy", "midrange"),
        playstyle_hints=args.get("playstyle_hints", ""),
        signature_cards=args.get("signature_cards"),
        budget_max=args.get("budget_max"),
        existing_card_ids=args.get("existing_card_ids"),
    )
    return json.dumps(result, default=str)


async def _handle_validate_deck(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.ai.deck_validator import validate_deck

    leader = await get_card_by_id(ctx.driver, args["leader_id"])
    if leader is None:
        return json.dumps({"error": f"Leader {args['leader_id']} not found"})

    cards = []
    for cid in args.get("card_ids", []):
        card = await get_card_by_id(ctx.driver, cid)
        if card:
            cards.append(card)

    report = validate_deck(leader, cards)
    return json.dumps(report.to_dict(), default=str)


async def _handle_suggest_deck_fixes(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.ai.deck_suggestions import suggest_fixes

    result = await suggest_fixes(ctx.driver, args["leader_id"], args.get("card_ids", []))
    return json.dumps(result, default=str)


async def _handle_suggest_card_swap(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.ai.deck_builder import ROLE_KEYWORDS, STRATEGY_TEMPLATES

    deck_ids = args.get("deck_card_ids", [])
    incoming_id = args["incoming_card_id"]

    async with ctx.driver.session() as session:
        inc_r = await session.run(
            "MATCH (c:Card {id: $card_id}) "
            "OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword) "
            "RETURN c, collect(DISTINCT k.name) AS keywords",
            card_id=incoming_id,
        )
        inc_rec = await inc_r.single()
        if not inc_rec:
            return json.dumps({"error": f"Card {incoming_id} not found"})

        incoming = dict(inc_rec["c"])
        incoming["keywords"] = inc_rec["keywords"]

        # Fetch deck cards with keywords + synergy counts
        deck_r = await session.run(
            """
            UNWIND $card_ids AS cid
            MATCH (c:Card {id: cid})
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            OPTIONAL MATCH (c)-[syn:SYNERGY]-(other:Card)
                WHERE other.id IN $card_ids AND other.id <> c.id
            OPTIONAL MATCH (c)-[msyn:MECHANICAL_SYNERGY]-(other2:Card)
                WHERE other2.id IN $card_ids AND other2.id <> c.id
            WITH c, collect(DISTINCT k.name) AS keywords,
                 count(DISTINCT syn) AS syn_count,
                 count(DISTINCT msyn) AS msyn_count
            RETURN c, keywords, syn_count, msyn_count
            """,
            card_ids=deck_ids,
        )
        deck_cards = []
        async for r in deck_r:
            card = dict(r["c"])
            card["keywords"] = r["keywords"]
            card["syn_count"] = r["syn_count"]
            card["msyn_count"] = r["msyn_count"]
            deck_cards.append(card)

    if not deck_cards:
        return json.dumps({"error": "No deck cards found"})

    # Use midrange role targets as baseline
    role_targets = STRATEGY_TEMPLATES["midrange"]["role_targets"]
    cost_targets = STRATEGY_TEMPLATES["midrange"]["cost_targets"]

    # Count current roles
    role_counts: dict[str, int] = {role: 0 for role in ROLE_KEYWORDS}
    for card in deck_cards:
        kws = set(card.get("keywords", []))
        for role, role_kws in ROLE_KEYWORDS.items():
            if kws & set(role_kws):
                role_counts[role] += 1

    # Count current cost curve
    cost_counts: dict[tuple, int] = {}
    for (cmin, cmax), _ in cost_targets.items():
        cost_counts[(cmin, cmax)] = sum(
            1 for c in deck_cards if cmin <= (c.get("cost") or 0) <= cmax
        )

    def card_value(card: dict) -> float:
        score = 0.0
        score += (card.get("tournament_pick_rate") or 0) * 3.0
        score += (card.get("top_cut_rate") or 0) * 5.0
        score += min((card.get("counter") or 0) / 1000, 2.0)
        return score

    def removal_penalty(card: dict) -> float:
        """Penalty for removing this card based on role/curve/synergy impact."""
        penalty = 0.0
        kws = set(card.get("keywords", []))

        # Role impact: penalize if removal drops a role below target
        for role, role_kws in ROLE_KEYWORDS.items():
            if kws & set(role_kws):
                target = role_targets.get(role, 0)
                if role_counts.get(role, 0) <= target:
                    penalty += 5.0  # Critical: would drop below target
                    break

        # Curve impact: penalize if removal thins a cost tier below minimum
        card_cost = card.get("cost") or 0
        for (cmin, cmax), (tmin, _) in cost_targets.items():
            if cmin <= card_cost <= cmax:
                if cost_counts.get((cmin, cmax), 0) <= tmin:
                    penalty += 3.0
                break

        # Synergy loss: penalize cards with many connections
        syn = card.get("syn_count", 0)
        msyn = card.get("msyn_count", 0)
        penalty += (syn + msyn) * 0.5

        return penalty

    incoming_cost = incoming.get("cost") or 0
    candidates = []
    for card in deck_cards:
        cost_diff_penalty = abs((card.get("cost") or 0) - incoming_cost) * 0.1
        swap_score = card_value(card) - cost_diff_penalty - removal_penalty(card)
        candidates.append((swap_score, card))

    candidates.sort(key=lambda x: x[0])
    weakest = candidates[0][1]

    # Build detailed reason
    reasons = []
    reasons.append("Lowest swap score in deck")
    if weakest.get("syn_count", 0) == 0 and weakest.get("msyn_count", 0) == 0:
        reasons.append("no synergy edges with other deck cards")
    pick = weakest.get("tournament_pick_rate") or 0
    if pick < 0.1:
        reasons.append(f"low tournament pick rate ({pick:.0%})")

    return json.dumps(
        {
            "remove_id": weakest.get("id", ""),
            "remove_name": weakest.get("name", ""),
            "add_id": incoming.get("id", ""),
            "add_name": incoming.get("name", ""),
            "reason": f"Swap recommended: {'; '.join(reasons)}",
        },
        default=str,
    )


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

BUILD_DECK_SHELL = AgentTool(
    name="build_deck_shell",
    description="Build a legal, competitive 50-card deck for a Leader. Enforces all OPTCG rules (50 cards, max 4 copies, color match, no LEADERs in deck). If user already has cards in deck, pass them as existing_card_ids to keep them and fill the remaining slots.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
            "budget_max": {"type": "number", "description": "Max total price in USD (optional)"},
            "strategy": {"type": "string", "enum": ["aggro", "midrange", "control"]},
            "playstyle_hints": {
                "type": "string",
                "description": "Comma-separated playstyle preferences from user (e.g. 'rush,low_curve,card_advantage'). Get these from analyze_leader_playstyles results.",
            },
            "signature_cards": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Card IDs that MUST be included (signature cards from playstyle analysis)",
            },
            "existing_card_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Card IDs already in the user's deck. These will be kept and the remaining slots filled. Pass this when user asks to 'finish' or 'complete' an existing deck.",
            },
        },
        "required": ["leader_id"],
    },
    handler=_handle_build_deck_shell,
    category="deck",
)

VALIDATE_DECK = AgentTool(
    name="validate_deck",
    description="Validate a deck against official OPTCG rules and competitive quality standards. Returns PASS/FAIL/WARNING for each check. Use this after building a deck to check for issues.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
            "card_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of 50 card IDs in the deck",
            },
        },
        "required": ["leader_id", "card_ids"],
    },
    handler=_handle_validate_deck,
    category="deck",
)

SUGGEST_DECK_FIXES = AgentTool(
    name="suggest_deck_fixes",
    description="Get smart replacement suggestions for deck validation issues. For each FAIL/WARNING, suggests which card to remove and what to add instead. Use after validate_deck shows problems.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
            "card_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of card IDs in the deck",
            },
        },
        "required": ["leader_id", "card_ids"],
    },
    handler=_handle_suggest_deck_fixes,
    category="deck",
)

SUGGEST_CARD_SWAP = AgentTool(
    name="suggest_card_swap",
    description="Suggest which card to remove from a full deck (50 cards) when adding a new card. Analyzes tournament pick rates, role coverage, and cost curve impact. Returns a 1-in-1-out recommendation.",
    parameters={
        "type": "object",
        "properties": {
            "deck_card_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Current deck card IDs",
            },
            "incoming_card_id": {"type": "string", "description": "Card the user wants to add"},
            "leader_id": {"type": "string", "description": "Leader card ID (optional)"},
        },
        "required": ["deck_card_ids", "incoming_card_id"],
    },
    handler=_handle_suggest_card_swap,
    category="deck",
)

DECK_TOOLS: list[AgentTool] = [
    BUILD_DECK_SHELL,
    VALIDATE_DECK,
    SUGGEST_DECK_FIXES,
    SUGGEST_CARD_SWAP,
]
