"""Execute agent tool calls against Neo4j and other services."""

import json
import logging
from collections import Counter

from neo4j import AsyncDriver

from backend.graph.queries import get_card_by_id, get_card_synergies, search_cards

logger = logging.getLogger(__name__)


async def execute_tool(tool_name: str, tool_input: dict, driver: AsyncDriver) -> dict:
    """Execute a tool call and return the result."""
    try:
        if tool_name == "query_neo4j":
            return await _execute_cypher(driver, tool_input)
        elif tool_name == "get_card":
            return await _get_card(driver, tool_input)
        elif tool_name == "find_synergies":
            return await _find_synergies(driver, tool_input)
        elif tool_name == "find_counters":
            return await _find_counters(driver, tool_input)
        elif tool_name == "get_mana_curve":
            return await _get_mana_curve(driver, tool_input)
        elif tool_name == "analyze_leader_playstyles":
            return await _analyze_leader_playstyles(driver, tool_input)
        elif tool_name == "build_deck_shell":
            return await _build_deck_shell(driver, tool_input)
        elif tool_name == "update_ui_state":
            return {"action": tool_input.get("action"), "payload": tool_input.get("payload"), "status": "emitted"}
        elif tool_name == "validate_deck":
            return await _validate_deck(driver, tool_input)
        elif tool_name == "suggest_deck_fixes":
            return await _suggest_deck_fixes(driver, tool_input)
        elif tool_name == "get_meta_overview":
            return await _get_meta_overview(driver)
        elif tool_name == "get_leader_meta":
            return await _get_leader_meta(driver, tool_input)
        elif tool_name == "compare_deck_to_meta":
            return await _compare_deck_to_meta(driver, tool_input)
        elif tool_name == "recommend_meta_cards":
            return await _recommend_meta_cards(driver, tool_input)
        elif tool_name == "suggest_card_swap":
            return await _suggest_card_swap(driver, tool_input)
        elif tool_name == "get_banned_cards":
            return await _get_banned_cards(driver)
        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        logger.error(f"Tool execution error ({tool_name}): {e}")
        return {"error": str(e)}


async def _execute_cypher(driver: AsyncDriver, params: dict) -> dict:
    """Execute a raw Cypher query."""
    cypher = params.get("cypher", "")
    query_params = params.get("params", {})

    # Safety: block write operations
    cypher_upper = cypher.upper().strip()
    if any(kw in cypher_upper for kw in ["CREATE", "DELETE", "SET", "MERGE", "REMOVE", "DROP"]):
        return {"error": "Write operations are not allowed from agent queries"}

    async with driver.session() as session:
        result = await session.run(cypher, **(query_params or {}))
        records = [dict(r) async for r in result]
        # Convert Neo4j objects to plain dicts
        serialized = []
        for rec in records:
            row = {}
            for k, v in rec.items():
                if hasattr(v, "items"):
                    row[k] = dict(v)
                elif isinstance(v, list):
                    row[k] = [dict(i) if hasattr(i, "items") else i for i in v]
                else:
                    row[k] = v
            serialized.append(row)
        return {"results": serialized, "count": len(serialized)}


async def _get_card(driver: AsyncDriver, params: dict) -> dict:
    card = await get_card_by_id(driver, params["card_id"])
    if card is None:
        return {"error": f"Card {params['card_id']} not found"}
    return card


async def _find_synergies(driver: AsyncDriver, params: dict) -> dict:
    partners = await get_card_synergies(
        driver,
        params["card_id"],
        params.get("max_hops", 1),
        params.get("color_filter"),
    )
    return {"card_id": params["card_id"], "partners": partners, "total": len(partners)}


async def _find_counters(driver: AsyncDriver, params: dict) -> dict:
    """Find cards that can counter a target card based on mechanics."""
    target_id = params["target_card_id"]
    user_color = params.get("user_color")

    # Get target card info
    target = await get_card_by_id(driver, target_id)
    if target is None:
        return {"error": f"Card {target_id} not found"}

    # Find counters based on keyword matchups
    color_clause = ""
    query_params: dict = {"target_id": target_id}
    if user_color:
        color_clause = "AND (c)-[:HAS_COLOR]->(:Color {name: $color})"
        query_params["color"] = user_color

    async with driver.session() as session:
        # Find cards with removal effects that can handle the target
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
        return {
            "target": target,
            "counters": [
                {"card": dict(r["c"]), "counter_keywords": r["counter_keywords"]}
                for r in records
            ],
        }


async def _get_mana_curve(driver: AsyncDriver, params: dict) -> dict:
    card_ids = params.get("card_ids", [])
    if not card_ids:
        return {"error": "No card_ids provided"}

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card) WHERE c.id IN $ids AND c.cost IS NOT NULL
            RETURN c.cost AS cost, count(c) AS count, collect(c.id) AS cards
            ORDER BY cost
            """,
            ids=card_ids,
        )
        curve = [dict(r) async for r in result]
        return {"curve": curve, "total": sum(e["count"] for e in curve)}


async def _analyze_leader_playstyles(driver: AsyncDriver, params: dict) -> dict:
    """Analyze tournament data to discover playstyles for a leader."""
    from backend.ai.playstyle_analyzer import analyze_leader_playstyles

    profiles = await analyze_leader_playstyles(driver, params["leader_id"])
    return {
        "leader_id": params["leader_id"],
        "playstyles": [p.to_dict() for p in profiles],
        "instruction": "Present these playstyles to the user and ask which they prefer before building.",
    }


async def _build_deck_shell(driver: AsyncDriver, params: dict) -> dict:
    """Build a legal, competitive deck using the DeckBuildingEngine."""
    from backend.ai.deck_builder import build_deck

    return await build_deck(
        driver=driver,
        leader_id=params["leader_id"],
        strategy=params.get("strategy", "midrange"),
        playstyle_hints=params.get("playstyle_hints", ""),
        signature_cards=params.get("signature_cards"),
        budget_max=params.get("budget_max"),
    )


async def _validate_deck(driver: AsyncDriver, params: dict) -> dict:
    """Validate a deck against OPTCG rules."""
    from backend.ai.deck_validator import validate_deck

    leader = await get_card_by_id(driver, params["leader_id"])
    if leader is None:
        return {"error": f"Leader {params['leader_id']} not found"}

    cards = []
    for cid in params.get("card_ids", []):
        card = await get_card_by_id(driver, cid)
        if card:
            cards.append(card)

    report = validate_deck(leader, cards)
    return report.to_dict()


async def _suggest_deck_fixes(driver: AsyncDriver, params: dict) -> dict:
    """Get smart replacement suggestions for deck issues."""
    from backend.ai.deck_suggestions import suggest_fixes

    return await suggest_fixes(driver, params["leader_id"], params.get("card_ids", []))


async def _get_meta_overview(driver: AsyncDriver) -> dict:
    """Get current tournament meta overview."""
    async with driver.session() as session:
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
        leaders = [{"id": r["id"], "name": r["name"], "deck_count": r["cnt"]} async for r in leader_r]

    return {
        "total_decks": total_decks,
        "total_tournaments": total_tournaments,
        "top_archetypes": archetypes,
        "top_leaders": leaders,
    }


async def _get_leader_meta(driver: AsyncDriver, params: dict) -> dict:
    """Get tournament meta stats for a specific leader."""
    leader_id = params["leader_id"]
    async with driver.session() as session:
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
            return {"leader_id": leader_id, "total_decks": 0}

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

    return {
        "leader_id": leader_id,
        "leader_name": rec["leader_name"] or "",
        "total_decks": rec["total_decks"],
        "avg_placement": round(rec["avg_placement"], 1) if rec["avg_placement"] else None,
        "top_cut_count": rec["top_cut_count"],
        "top_archetypes": rec["top_archetypes"] or [],
        "popular_cards": popular,
    }


async def _compare_deck_to_meta(driver: AsyncDriver, params: dict) -> dict:
    """Compare user's deck vs tournament-winning decks for same leader."""
    leader_id = params["leader_id"]
    user_ids = set(params.get("deck_card_ids", []))

    async with driver.session() as session:
        # Get most popular cards for this leader
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

    return {
        "leader_id": leader_id,
        "missing_popular_cards": missing[:15],
        "unusual_cards_in_deck": unusual[:10],
        "meta_overlap": len(user_ids & meta_ids),
        "meta_total": len(meta_ids),
    }


async def _recommend_meta_cards(driver: AsyncDriver, params: dict) -> dict:
    """Recommend tournament-proven cards for a leader."""
    leader_id = params["leader_id"]
    limit = params.get("limit", 10)

    async with driver.session() as session:
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

    return {"leader_id": leader_id, "recommended_cards": cards}


async def _suggest_card_swap(driver: AsyncDriver, params: dict) -> dict:
    """Suggest 1-in-1-out swap for a full deck."""
    from backend.api.routes_meta import router  # noqa: avoid circular

    deck_ids = params.get("deck_card_ids", [])
    incoming_id = params["incoming_card_id"]
    leader_id = params.get("leader_id")

    # Reuse the same logic as the API endpoint
    async with driver.session() as session:
        inc_r = await session.run(
            "MATCH (c:Card {id: $card_id}) RETURN c",
            card_id=incoming_id,
        )
        inc_rec = await inc_r.single()
        if not inc_rec:
            return {"error": f"Card {incoming_id} not found"}

        incoming = dict(inc_rec["c"])

        deck_r = await session.run(
            """
            UNWIND $card_ids AS cid
            MATCH (c:Card {id: cid})
            RETURN c
            """,
            card_ids=deck_ids,
        )
        deck_cards = [dict(r["c"]) async for r in deck_r]

    if not deck_cards:
        return {"error": "No deck cards found"}

    # Score: lowest value = best to remove
    def card_value(card: dict) -> float:
        score = 0.0
        score += (card.get("tournament_pick_rate") or 0) * 3.0
        score += (card.get("top_cut_rate") or 0) * 5.0
        score += min((card.get("counter") or 0) / 1000, 2.0)
        return score

    incoming_cost = incoming.get("cost") or 0
    candidates = []
    for card in deck_cards:
        cost_penalty = abs((card.get("cost") or 0) - incoming_cost) * 0.1
        candidates.append((card_value(card) - cost_penalty, card))

    candidates.sort(key=lambda x: x[0])
    weakest = candidates[0][1]

    return {
        "remove_id": weakest.get("id", ""),
        "remove_name": weakest.get("name", ""),
        "add_id": incoming.get("id", ""),
        "add_name": incoming.get("name", ""),
        "reason": "Swap recommended: lower tournament value card replaced",
    }


async def _get_banned_cards(driver: AsyncDriver) -> dict:
    """Get the official banned card list from the knowledge graph."""
    from backend.graph.queries import get_banned_cards
    banned = await get_banned_cards(driver)
    return {
        "banned_cards": banned,
        "total": len(banned),
        "note": "These cards are banned from official tournament play. NEVER include them in any deck.",
    }
