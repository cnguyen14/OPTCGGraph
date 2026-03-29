"""Reusable Cypher query functions for the OPTCG knowledge graph."""

from neo4j import AsyncDriver


async def get_card_by_id(driver: AsyncDriver, card_id: str) -> dict | None:
    """Get a single card with all its properties and relationships."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card {id: $id})
            OPTIONAL MATCH (c)-[:HAS_COLOR]->(color:Color)
            OPTIONAL MATCH (c)-[:BELONGS_TO]->(family:Family)
            OPTIONAL MATCH (c)-[:FROM_SET]->(s:Set)
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
            RETURN c,
                   collect(DISTINCT color.name) AS colors,
                   collect(DISTINCT family.name) AS families,
                   s.name AS set_name,
                   collect(DISTINCT kw.name) AS keywords
            """,
            id=card_id,
        )
        record = await result.single()
        if record is None:
            return None

        card_node = record["c"]
        return {
            **dict(card_node),
            "colors": record["colors"],
            "families": record["families"],
            "set_name": record["set_name"],
            "keywords": record["keywords"],
        }


async def get_card_synergies(
    driver: AsyncDriver, card_id: str, max_hops: int = 1, color_filter: str | None = None
) -> list[dict]:
    """Find synergy partners for a card.

    For LEADERs: shows only CHARACTER/EVENT/STAGE that could go in a deck.
    For non-LEADERs: shows all synergy partners except other LEADERs.
    Only uses SYNERGY edges (family+color based), not MECHANICAL_SYNERGY.
    """
    color_clause = ""
    query_params: dict = {"id": card_id}
    if color_filter:
        color_clause = "AND (partner)-[:HAS_COLOR]->(:Color {name: $color})"
        query_params["color"] = color_filter

    # Only use SYNERGY edges (family+color), exclude LEADER↔LEADER
    query = f"""
        MATCH (c:Card {{id: $id}})-[:SYNERGY*1..{max_hops}]-(partner:Card)
        WHERE partner.id <> $id
          AND partner.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
          {color_clause}
        RETURN DISTINCT partner
        LIMIT 50
    """
    async with driver.session() as session:
        result = await session.run(query, **query_params)
        records = [record async for record in result]
        return [dict(r["partner"]) for r in records]


async def get_card_network(driver: AsyncDriver, card_id: str, hops: int = 2) -> dict:
    """Get N-hop subgraph around a card. Returns nodes and edges."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH path = (c:Card {id: $id})-[*1..$hops]-(connected)
            WHERE connected:Card OR connected:Family OR connected:Color OR connected:Keyword
            UNWIND relationships(path) AS rel
            WITH collect(DISTINCT connected) AS nodes, collect(DISTINCT rel) AS rels
            RETURN nodes, rels
            """,
            id=card_id,
            hops=hops,
        )
        record = await result.single()
        if record is None:
            return {"nodes": [], "edges": []}

        nodes = [dict(n) for n in record["nodes"]]
        edges = [
            {
                "type": type(r).__name__,
                "start": r.start_node.element_id,
                "end": r.end_node.element_id,
                "properties": dict(r),
            }
            for r in record["rels"]
        ]
        return {"nodes": nodes, "edges": edges}


async def search_cards(
    driver: AsyncDriver,
    keyword: str | None = None,
    cost_min: int | None = None,
    cost_max: int | None = None,
    color: str | None = None,
    card_type: str | None = None,
    family: str | None = None,
    sort_by: str = "name",
    sort_order: str = "asc",
    offset: int = 0,
    limit: int = 25,
) -> dict:
    """Search cards with filters, pagination, and sorting."""
    sort_allowlist = {
        "name": "c.name",
        "cost": "c.cost",
        "power": "c.power",
        "market_price": "c.market_price",
    }
    sort_field = sort_allowlist.get(sort_by, "c.name")
    order = "DESC" if sort_order == "desc" else "ASC"

    conditions: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    if keyword:
        conditions.append("(c.ability CONTAINS $keyword OR c.name CONTAINS $keyword)")
        params["keyword"] = keyword
    if cost_min is not None:
        conditions.append("c.cost >= $cost_min")
        params["cost_min"] = cost_min
    if cost_max is not None:
        conditions.append("c.cost <= $cost_max")
        params["cost_max"] = cost_max
    if color:
        conditions.append("(c)-[:HAS_COLOR]->(:Color {name: $color})")
        params["color"] = color
    if card_type:
        conditions.append("c.card_type = $card_type")
        params["card_type"] = card_type.upper()
    if family:
        conditions.append("(c)-[:BELONGS_TO]->(:Family {name: $family})")
        params["family"] = family

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    async with driver.session() as session:
        # Count query
        count_result = await session.run(
            f"MATCH (c:Card) {where} RETURN count(c) AS total",
            **params,
        )
        count_record = await count_result.single()
        total = count_record["total"] if count_record else 0

        # Data query with joins
        data_result = await session.run(
            f"""
            MATCH (c:Card) {where}
            OPTIONAL MATCH (c)-[:HAS_COLOR]->(clr:Color)
            OPTIONAL MATCH (c)-[:BELONGS_TO]->(fam:Family)
            OPTIONAL MATCH (c)-[:FROM_SET]->(s:Set)
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
            WITH c,
                 collect(DISTINCT clr.name) AS colors,
                 collect(DISTINCT fam.name) AS families,
                 s.name AS set_name,
                 collect(DISTINCT kw.name) AS keywords
            ORDER BY {sort_field} {order}
            SKIP $offset LIMIT $limit
            """,
            **params,
        )
        cards = []
        async for record in data_result:
            card_node = record["c"]
            cards.append({
                **dict(card_node),
                "colors": record["colors"],
                "families": record["families"],
                "set_name": record["set_name"],
                "keywords": record["keywords"],
            })

        return {"cards": cards, "total": total, "offset": offset, "limit": limit}


async def get_facets(driver: AsyncDriver) -> dict:
    """Get available filter values for card search."""
    async with driver.session() as session:
        colors_result = await session.run("MATCH (c:Color) RETURN c.name AS name ORDER BY c.name")
        colors = [r["name"] async for r in colors_result]

        types_result = await session.run("MATCH (c:Card) RETURN DISTINCT c.card_type AS name ORDER BY name")
        card_types = [r["name"] async for r in types_result]

        families_result = await session.run("MATCH (f:Family) RETURN f.name AS name ORDER BY f.name")
        families = [r["name"] async for r in families_result]

        return {"colors": colors, "card_types": card_types, "families": families}


async def get_db_stats(driver: AsyncDriver) -> dict:
    """Get database statistics."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card) WITH count(c) AS cards
            OPTIONAL MATCH (:Color) WITH cards, count(*) AS colors
            OPTIONAL MATCH (:Family) WITH cards, colors, count(*) AS families
            OPTIONAL MATCH (:Set) WITH cards, colors, families, count(*) AS sets
            OPTIONAL MATCH (:Keyword) WITH cards, colors, families, sets, count(*) AS keywords
            RETURN cards, colors, families, sets, keywords
            """
        )
        record = await result.single()
        if record is None:
            return {}
        return dict(record)
