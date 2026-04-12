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
    driver: AsyncDriver,
    card_id: str,
    max_hops: int = 1,
    color_filter: str | None = None,
    include_mechanical: bool = False,
) -> list[dict]:
    """Find synergy partners for a card.

    For LEADERs: shows only CHARACTER/EVENT/STAGE that could go in a deck.
    For non-LEADERs: shows all synergy partners except other LEADERs.
    Uses SYNERGY edges (family+color). When include_mechanical=True, also
    includes MECHANICAL_SYNERGY edges (keyword+color).
    """
    color_clause = ""
    query_params: dict = {"id": card_id}
    if color_filter:
        color_clause = "AND (partner)-[:HAS_COLOR]->(:Color {name: $color})"
        query_params["color"] = color_filter

    rel_pattern = "SYNERGY|MECHANICAL_SYNERGY" if include_mechanical else "SYNERGY"

    # Direct edges (1-hop) return rich metadata; multi-hop returns partners only
    if max_hops == 1:
        query = f"""
            MATCH (c:Card {{id: $id}})-[r:{rel_pattern}]-(partner:Card)
            WHERE partner.id <> $id
              AND partner.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
              {color_clause}
            RETURN DISTINCT partner,
                   type(r) AS synergy_type,
                   r.weight AS synergy_weight,
                   r.shared_families AS shared_families,
                   r.shared_keywords AS shared_keywords
            ORDER BY r.weight DESC
            LIMIT 50
        """
    else:
        query = f"""
            MATCH (c:Card {{id: $id}})-[:{rel_pattern}*1..{max_hops}]-(partner:Card)
            WHERE partner.id <> $id
              AND partner.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
              {color_clause}
            RETURN DISTINCT partner
            LIMIT 50
        """

    async with driver.session() as session:
        result = await session.run(query, **query_params)
        records = [record async for record in result]
        partners = []
        for r in records:
            p = dict(r["partner"])
            if max_hops == 1:
                p["synergy_type"] = r["synergy_type"]
                p["synergy_weight"] = r["synergy_weight"]
                p["shared_families"] = r["shared_families"] or []
                p["shared_keywords"] = r["shared_keywords"] or []
            partners.append(p)
        return partners


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
    set_name: str | None = None,
    rarity: str | None = None,
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
        conditions.append(
            "(toLower(c.id) CONTAINS $keyword OR toLower(c.name) CONTAINS $keyword OR toLower(c.ability) CONTAINS $keyword)"
        )
        params["keyword"] = keyword.lower()
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
    if set_name:
        # Support both set ID (e.g. "OP15") and set name
        conditions.append(
            "EXISTS { MATCH (c)-[:FROM_SET]->(s:Set) WHERE s.id = $set_name OR s.name = $set_name }"
        )
        params["set_name"] = set_name
    if rarity:
        conditions.append("c.rarity = $rarity")
        params["rarity"] = rarity

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    async with driver.session() as session:
        # Count query
        count_result = await session.run(
            f"MATCH (c:Card) {where} RETURN count(c) AS total",
            **params,
        )
        count_record = await count_result.single()
        total = count_record["total"] if count_record else 0

        # Data query — paginate first, then join relationships (avoids memory explosion)
        data_result = await session.run(
            f"""
            MATCH (c:Card) {where}
            WITH c ORDER BY {sort_field} {order}
            SKIP $offset LIMIT $limit
            OPTIONAL MATCH (c)-[:HAS_COLOR]->(clr:Color)
            WITH c, collect(DISTINCT clr.name) AS colors
            OPTIONAL MATCH (c)-[:BELONGS_TO]->(fam:Family)
            WITH c, colors, collect(DISTINCT fam.name) AS families
            OPTIONAL MATCH (c)-[:FROM_SET]->(s:Set)
            WITH c, colors, families, coalesce(s.name, '') AS set_name
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
            RETURN c, colors, families, set_name,
                   collect(DISTINCT kw.name) AS keywords
            """,
            **params,
        )
        cards = []
        async for record in data_result:
            card_node = record["c"]
            cards.append(
                {
                    **dict(card_node),
                    "colors": record["colors"],
                    "families": record["families"],
                    "set_name": record["set_name"],
                    "keywords": record["keywords"],
                }
            )

        return {"cards": cards, "total": total, "offset": offset, "limit": limit}


async def get_facets(driver: AsyncDriver) -> dict:
    """Get available filter values for card search."""
    async with driver.session() as session:
        colors_result = await session.run("MATCH (c:Color) RETURN c.name AS name ORDER BY c.name")
        colors = [r["name"] async for r in colors_result]

        types_result = await session.run(
            "MATCH (c:Card) RETURN DISTINCT c.card_type AS name ORDER BY name"
        )
        card_types = [r["name"] async for r in types_result]

        families_result = await session.run(
            "MATCH (f:Family) RETURN f.name AS name ORDER BY f.name"
        )
        families = [r["name"] async for r in families_result]

        sets_result = await session.run(
            "MATCH (s:Set) RETURN DISTINCT s.id AS id, s.name AS name ORDER BY s.id"
        )
        sets = [{"id": r["id"], "name": r["name"]} async for r in sets_result]

        rarities_result = await session.run(
            "MATCH (c:Card) WHERE c.rarity IS NOT NULL AND c.rarity <> '' "
            "RETURN DISTINCT c.rarity AS name ORDER BY name"
        )
        rarities = [r["name"] async for r in rarities_result]

        return {
            "colors": colors,
            "card_types": card_types,
            "families": families,
            "sets": sets,
            "rarities": rarities,
        }


async def get_deck_synergies(driver: AsyncDriver, card_ids: list[str]) -> dict:
    """Find all SYNERGY and MECHANICAL_SYNERGY edges between a set of cards.

    Returns nodes (cards) and edges (synergy relationships) for visualization.
    """
    if not card_ids:
        return {"nodes": [], "edges": []}

    async with driver.session() as session:
        # Get all synergy edges between cards in the deck
        result = await session.run(
            """
            MATCH (a:Card)-[r:SYNERGY|MECHANICAL_SYNERGY|CURVES_INTO]-(b:Card)
            WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
            OPTIONAL MATCH (a)-[:HAS_COLOR]->(ca:Color)
            OPTIONAL MATCH (b)-[:HAS_COLOR]->(cb:Color)
            RETURN a.id AS source, b.id AS target,
                   type(r) AS rel_type,
                   r.weight AS weight,
                   r.shared_families AS shared_families,
                   r.shared_keywords AS shared_keywords,
                   r.cost_diff AS cost_diff
            """,
            ids=card_ids,
        )
        edges = []
        async for r in result:
            edge: dict = {
                "source": r["source"],
                "target": r["target"],
                "type": r["rel_type"],
                "weight": r["weight"],
            }
            if r["shared_families"]:
                edge["shared_families"] = r["shared_families"]
            if r["shared_keywords"]:
                edge["shared_keywords"] = r["shared_keywords"]
            if r["cost_diff"] is not None:
                edge["cost_diff"] = r["cost_diff"]
            edges.append(edge)

        return {"edges": edges}


async def get_db_stats(driver: AsyncDriver) -> dict:
    """Get database statistics including node and edge counts."""
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

        stats = dict(record)

        # Edge counts — separate queries to avoid OPTIONAL MATCH chaining issues
        edge_result = await session.run(
            """
            CALL { MATCH ()-[s:SYNERGY]-() RETURN count(s)/2 AS synergy_edges }
            CALL { MATCH ()-[m:MECHANICAL_SYNERGY]-() RETURN count(m)/2 AS mech_synergy_edges }
            CALL { MATCH ()-[ci:CURVES_INTO]-() RETURN count(ci) AS curves_into_edges }
            CALL { MATCH (c:Card) WHERE c.banned = true RETURN count(c) AS banned_cards }
            RETURN synergy_edges, mech_synergy_edges, curves_into_edges, banned_cards
            """
        )
        edge_record = await edge_result.single()
        if edge_record:
            stats.update(dict(edge_record))

        return stats


async def get_banned_cards(driver: AsyncDriver) -> list[dict]:
    """Get all banned cards from the database."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:Card) WHERE c.banned = true
            RETURN c.id AS id, c.name AS name, c.ban_reason AS ban_reason,
                   c.image_small AS image_small, c.card_type AS card_type
            ORDER BY c.id
            """
        )
        return [dict(r) async for r in result]
