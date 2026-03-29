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
        elif tool_name == "build_deck_shell":
            return await _build_deck_shell(driver, tool_input)
        elif tool_name == "update_ui_state":
            return {"action": tool_input.get("action"), "payload": tool_input.get("payload"), "status": "emitted"}
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


async def _build_deck_shell(driver: AsyncDriver, params: dict) -> dict:
    """Build a legal, competitive deck using the DeckBuildingEngine."""
    from backend.ai.deck_builder import build_deck

    return await build_deck(
        driver=driver,
        leader_id=params["leader_id"],
        strategy=params.get("strategy", "midrange"),
        budget_max=params.get("budget_max"),
    )
