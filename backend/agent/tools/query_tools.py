"""Query tools — raw Cypher execution and banned card lookup."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_query_neo4j(args: dict, ctx: ToolExecutionContext) -> str:
    cypher = args.get("cypher", "")
    query_params = args.get("params", {})

    # Safety: block write operations (also enforced by cypher_safety guardrail)
    cypher_upper = cypher.upper().strip()
    if any(kw in cypher_upper for kw in ["CREATE", "DELETE", "SET", "MERGE", "REMOVE", "DROP"]):
        return json.dumps({"error": "Write operations are not allowed from agent queries"})

    async with ctx.driver.session() as session:
        result = await session.run(cypher, **(query_params or {}))
        records = [dict(r) async for r in result]
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
        return json.dumps({"results": serialized, "count": len(serialized)}, default=str)


async def _handle_get_banned_cards(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.graph.queries import get_banned_cards

    banned = await get_banned_cards(ctx.driver)
    return json.dumps(
        {
            "banned_cards": banned,
            "total": len(banned),
            "note": "These cards are banned from official tournament play. NEVER include them in any deck.",
        },
        default=str,
    )


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

QUERY_NEO4J = AgentTool(
    name="query_neo4j",
    description="Execute a Cypher query against the OPTCG knowledge graph. Use for card data retrieval, synergy lookups, or graph traversal. Returns structured JSON.",
    parameters={
        "type": "object",
        "properties": {
            "cypher": {"type": "string", "description": "Valid Cypher query to execute"},
            "params": {"type": "object", "description": "Query parameters (optional)"},
        },
        "required": ["cypher"],
    },
    handler=_handle_query_neo4j,
    category="query",
)

GET_BANNED_CARDS = AgentTool(
    name="get_banned_cards",
    description="Get the official Bandai banned card list. Returns all cards currently banned from tournament play. ALWAYS check this before building a deck or recommending cards. Banned cards must NEVER be included in any deck.",
    parameters={"type": "object", "properties": {}},
    handler=_handle_get_banned_cards,
    category="query",
)

QUERY_TOOLS: list[AgentTool] = [QUERY_NEO4J, GET_BANNED_CARDS]
