"""Meta tools — tournament meta overview, leader stats, compare, recommend."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_get_meta_overview(args: dict, ctx: ToolExecutionContext) -> str:
    async with ctx.driver.session() as session:
        count_r = await session.run("MATCH (d:Deck) RETURN count(d) AS c")
        rec = await count_r.single()
        total_decks = rec["c"] if rec else 0

        t_r = await session.run("MATCH (t:Tournament) RETURN count(t) AS c")
        rec = await t_r.single()
        total_tournaments = rec["c"] if rec else 0

        arch_r = await session.run(
            """
            MATCH (d:Deck)
            WHERE d.archetype IS NOT NULL AND d.archetype <> ''
            RETURN d.archetype AS archetype, count(d) AS cnt
            ORDER BY cnt DESC LIMIT 15
            """
        )
        archetypes = []
        async for r in arch_r:
            archetypes.append({
                "archetype": r["archetype"],
                "count": r["cnt"],
                "share": round(r["cnt"] / total_decks, 3) if total_decks else 0,
            })

        leader_r = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(c:Card)
            RETURN c.id AS id, c.name AS name, count(d) AS cnt
            ORDER BY cnt DESC LIMIT 10
            """
        )
        leaders = [
            {"id": r["id"], "name": r["name"], "deck_count": r["cnt"]}
            async for r in leader_r
        ]

    return json.dumps({
        "total_decks": total_decks,
        "total_tournaments": total_tournaments,
        "top_archetypes": archetypes,
        "top_leaders": leaders,
    }, default=str)


async def _handle_get_leader_meta(args: dict, ctx: ToolExecutionContext) -> str:
    leader_id = args["leader_id"]
    async with ctx.driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(leader:Card {id: $leader_id})
            RETURN leader.name AS leader_name,
                   count(d) AS total_decks,
                   avg(d.placement) AS avg_placement,
                   count(CASE WHEN d.placement <= 8 THEN 1 END) AS top_cut_count,
                   collect(DISTINCT d.archetype)[..5] AS top_archetypes
            """,
            leader_id=leader_id,
        )
        rec = await result.single()
        if not rec or rec["total_decks"] == 0:
            return json.dumps({"leader_id": leader_id, "total_decks": 0})

        cards_r = await session.run(
            """
            MATCH (d:Deck {leader_id: $leader_id})-[inc:INCLUDES]->(c:Card)
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            ORDER BY deck_count DESC LIMIT 15
            RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
                   c.cost AS cost, deck_count, round(avg_copies * 10) / 10 AS avg_copies
            """,
            leader_id=leader_id,
        )
        popular = [dict(r) async for r in cards_r]

    return json.dumps({
        "leader_id": leader_id,
        "leader_name": rec["leader_name"] or "",
        "total_decks": rec["total_decks"],
        "avg_placement": round(rec["avg_placement"], 1) if rec["avg_placement"] else None,
        "top_cut_count": rec["top_cut_count"],
        "top_archetypes": rec["top_archetypes"] or [],
        "popular_cards": popular,
    }, default=str)


async def _handle_compare_deck_to_meta(args: dict, ctx: ToolExecutionContext) -> str:
    leader_id = args["leader_id"]
    user_ids = set(args.get("deck_card_ids", []))

    async with ctx.driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Deck {leader_id: $leader_id})-[inc:INCLUDES]->(c:Card)
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            ORDER BY deck_count DESC LIMIT 30
            RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
                   c.cost AS cost, deck_count, round(avg_copies * 10) / 10 AS avg_copies
            """,
            leader_id=leader_id,
        )
        meta_cards = [dict(r) async for r in result]

    meta_ids = {c["id"] for c in meta_cards}
    missing = [c for c in meta_cards if c["id"] not in user_ids]
    unusual = [cid for cid in user_ids if cid not in meta_ids]

    return json.dumps({
        "leader_id": leader_id,
        "missing_popular_cards": missing[:15],
        "unusual_cards_in_deck": unusual[:10],
        "meta_overlap": len(user_ids & meta_ids),
        "meta_total": len(meta_ids),
    }, default=str)


async def _handle_recommend_meta_cards(args: dict, ctx: ToolExecutionContext) -> str:
    leader_id = args["leader_id"]
    limit = args.get("limit", 10)

    async with ctx.driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Deck {leader_id: $leader_id})-[inc:INCLUDES]->(c:Card)
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            ORDER BY deck_count DESC
            LIMIT $limit
            RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
                   c.cost AS cost, c.power AS power, c.counter AS counter,
                   deck_count, round(avg_copies * 10) / 10 AS avg_copies,
                   c.tournament_pick_rate AS pick_rate,
                   c.top_cut_rate AS top_cut_rate
            """,
            leader_id=leader_id,
            limit=limit,
        )
        cards = [dict(r) async for r in result]

    return json.dumps({"leader_id": leader_id, "recommended_cards": cards}, default=str)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

GET_META_OVERVIEW = AgentTool(
    name="get_meta_overview",
    description="Get current tournament meta overview: top archetypes with play rates, most popular leaders. Use when user asks about the meta, what decks are popular, or meta trends.",
    parameters={"type": "object", "properties": {}},
    handler=_handle_get_meta_overview,
    category="meta",
)

GET_LEADER_META = AgentTool(
    name="get_leader_meta",
    description="Get tournament meta stats for a specific leader: how many decks use it, average placement, top archetypes, most popular cards. Use when user asks how a leader performs competitively.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID, e.g. 'OP12-061'"},
        },
        "required": ["leader_id"],
    },
    handler=_handle_get_leader_meta,
    category="meta",
)

COMPARE_DECK_TO_META = AgentTool(
    name="compare_deck_to_meta",
    description="Compare user's current deck against tournament-winning decks for the same leader. Shows which popular cards are missing and which unusual cards the user has. Use when user asks 'what am I missing?' or 'how does my deck compare?'.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
            "deck_card_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs in user's deck"},
        },
        "required": ["leader_id", "deck_card_ids"],
    },
    handler=_handle_compare_deck_to_meta,
    category="meta",
)

RECOMMEND_META_CARDS = AgentTool(
    name="recommend_meta_cards",
    description="Recommend tournament-proven cards for a leader. Returns cards sorted by top-cut rate and pick rate from real tournament data. Use when user asks 'what cards should I add?' or 'what's hot for this leader?'.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
            "limit": {"type": "integer", "default": 10, "description": "Number of cards to return"},
        },
        "required": ["leader_id"],
    },
    handler=_handle_recommend_meta_cards,
    category="meta",
)

META_TOOLS: list[AgentTool] = [GET_META_OVERVIEW, GET_LEADER_META, COMPARE_DECK_TO_META, RECOMMEND_META_CARDS]
