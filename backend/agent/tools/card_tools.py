"""Card tools — lookup, synergies, counters, mana curve."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext
from backend.graph.queries import get_card_by_id, get_card_synergies

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_get_card(args: dict, ctx: ToolExecutionContext) -> str:
    card = await get_card_by_id(ctx.driver, args["card_id"])
    if card is None:
        return json.dumps({"error": f"Card {args['card_id']} not found"})
    return json.dumps(card, default=str)


async def _handle_find_synergies(args: dict, ctx: ToolExecutionContext) -> str:
    partners = await get_card_synergies(
        ctx.driver,
        args["card_id"],
        args.get("max_hops", 1),
        args.get("color_filter"),
        include_mechanical=args.get("include_mechanical", False),
    )
    return json.dumps(
        {"card_id": args["card_id"], "partners": partners, "total": len(partners)},
        default=str,
    )


async def _handle_find_counters(args: dict, ctx: ToolExecutionContext) -> str:
    target_id = args["target_card_id"]
    user_color = args.get("user_color")

    target = await get_card_by_id(ctx.driver, target_id)
    if target is None:
        return json.dumps({"error": f"Card {target_id} not found"})

    color_clause = ""
    query_params: dict = {"target_id": target_id}
    if user_color:
        color_clause = "AND (c)-[:HAS_COLOR]->(:Color {name: $color})"
        query_params["color"] = user_color

    async with ctx.driver.session() as session:
        result = await session.run(
            f"""
            MATCH (c:Card)-[:HAS_KEYWORD]->(k:Keyword)
            WHERE k.name IN ['KO', 'Bounce', 'Trash', 'Power Debuff', 'Rest']
              AND c.card_type IN ['CHARACTER', 'EVENT']
              {color_clause}
            RETURN DISTINCT c, collect(k.name) AS counter_keywords
            ORDER BY size(collect(k.name)) DESC
            LIMIT 15
            """,
            **query_params,
        )
        records = [r async for r in result]
        return json.dumps(
            {
                "target": target,
                "counters": [
                    {"card": dict(r["c"]), "counter_keywords": r["counter_keywords"]}
                    for r in records
                ],
            },
            default=str,
        )


async def _handle_search_cards(args: dict, ctx: ToolExecutionContext) -> str:
    """Search cards by color, type, family, keyword, or name."""
    match_clauses = ["(c:Card)"]
    where_clauses: list[str] = []
    params: dict = {}

    color = args.get("color")
    if color:
        match_clauses.append("(c)-[:HAS_COLOR]->(:Color {name: $color})")
        params["color"] = color

    family = args.get("family")
    if family:
        match_clauses.append("(c)-[:BELONGS_TO]->(:Family {name: $family})")
        params["family"] = family

    keyword = args.get("keyword")
    if keyword:
        match_clauses.append("(c)-[:HAS_KEYWORD]->(:Keyword {name: $keyword})")
        params["keyword"] = keyword

    card_type = args.get("card_type")
    if card_type:
        where_clauses.append("c.card_type = $card_type")
        params["card_type"] = card_type.upper()

    name = args.get("name")
    if name:
        where_clauses.append("toLower(c.name) CONTAINS toLower($name)")
        params["name"] = name

    limit = args.get("limit", 20)
    params["limit"] = limit

    match_str = "MATCH " + ", ".join(match_clauses)
    where_str = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    cypher = f"""
        {match_str}{where_str}
        OPTIONAL MATCH (c)-[:HAS_COLOR]->(col:Color)
        OPTIONAL MATCH (c)-[:BELONGS_TO]->(fam:Family)
        RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
               c.cost AS cost, c.power AS power, c.life AS life,
               c.ability AS ability,
               collect(DISTINCT col.name) AS colors,
               collect(DISTINCT fam.name) AS families
        ORDER BY c.cost, c.name
        LIMIT $limit
    """

    async with ctx.driver.session() as session:
        result = await session.run(cypher, **params)
        records = [dict(r) async for r in result]

    return json.dumps({"cards": records, "total": len(records)}, default=str)


async def _handle_get_mana_curve(args: dict, ctx: ToolExecutionContext) -> str:
    card_ids = args.get("card_ids", [])
    if not card_ids:
        return json.dumps({"error": "No card_ids provided"})

    async with ctx.driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card) WHERE c.id IN $ids AND c.cost IS NOT NULL
            RETURN c.cost AS cost, count(c) AS count, collect(c.id) AS cards
            ORDER BY cost
            """,
            ids=card_ids,
        )
        curve = [dict(r) async for r in result]
        return json.dumps({"curve": curve, "total": sum(e["count"] for e in curve)}, default=str)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

GET_CARD = AgentTool(
    name="get_card",
    description="Get full details for a specific card by ID. Returns all properties including ability, keywords, pricing, images.",
    parameters={
        "type": "object",
        "properties": {
            "card_id": {"type": "string", "description": "Card ID, e.g. 'OP03-070'"},
        },
        "required": ["card_id"],
    },
    handler=_handle_get_card,
    category="card",
)

FIND_SYNERGIES = AgentTool(
    name="find_synergies",
    description="Find cards that synergize with a given card. Returns SYNERGY partners (shared family+color). Set include_mechanical=true to also get MECHANICAL_SYNERGY partners (shared keywords+color).",
    parameters={
        "type": "object",
        "properties": {
            "card_id": {"type": "string"},
            "max_hops": {
                "type": "integer",
                "default": 1,
                "description": "1=direct, 2=2-hop network",
            },
            "color_filter": {"type": "string", "description": "Filter by color (optional)"},
            "include_mechanical": {
                "type": "boolean",
                "default": False,
                "description": "Include MECHANICAL_SYNERGY (keyword-based) edges",
            },
        },
        "required": ["card_id"],
    },
    handler=_handle_find_synergies,
    category="card",
)

FIND_COUNTERS = AgentTool(
    name="find_counters",
    description="Find cards that counter a specific card or strategy.",
    parameters={
        "type": "object",
        "properties": {
            "target_card_id": {"type": "string", "description": "Card to counter"},
            "user_color": {"type": "string", "description": "User's deck color for filtering"},
        },
        "required": ["target_card_id"],
    },
    handler=_handle_find_counters,
    category="card",
)

SEARCH_CARDS = AgentTool(
    name="search_cards",
    description="Search for cards by color, type, family, keyword, or name. Returns matching cards with basic info. Use this to find cards matching criteria like 'Red leaders' or 'Blue characters with Rush'.",
    parameters={
        "type": "object",
        "properties": {
            "color": {
                "type": "string",
                "description": "Card color: Red, Green, Blue, Purple, Black, Yellow",
            },
            "card_type": {
                "type": "string",
                "description": "Card type: LEADER, CHARACTER, EVENT, STAGE",
            },
            "family": {"type": "string", "description": "Family/tribe name, e.g. 'Straw Hat Crew'"},
            "keyword": {"type": "string", "description": "Keyword ability, e.g. 'Rush', 'Blocker'"},
            "name": {"type": "string", "description": "Card name (partial match)"},
            "limit": {"type": "integer", "default": 20, "description": "Max results (default 20)"},
        },
    },
    handler=_handle_search_cards,
    category="card",
)

GET_MANA_CURVE = AgentTool(
    name="get_mana_curve",
    description="Get cost distribution for a set of cards.",
    parameters={
        "type": "object",
        "properties": {
            "card_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of card IDs",
            },
        },
        "required": ["card_ids"],
    },
    handler=_handle_get_mana_curve,
    category="card",
)

CARD_TOOLS: list[AgentTool] = [
    GET_CARD,
    SEARCH_CARDS,
    FIND_SYNERGIES,
    FIND_COUNTERS,
    GET_MANA_CURVE,
]
