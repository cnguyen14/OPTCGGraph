"""Compute synergy, mechanical, and strategic edges in the knowledge graph."""

import logging
from neo4j import AsyncDriver

logger = logging.getLogger(__name__)


async def build_synergy_edges(driver: AsyncDriver) -> int:
    """Build SYNERGY edges: cards sharing ≥1 family within same color."""
    async with driver.session() as session:
        # Delete existing SYNERGY edges first
        await session.run("MATCH ()-[r:SYNERGY]->() DELETE r")

        result = await session.run(
            """
            MATCH (a:Card)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(b:Card)
            WHERE a.id < b.id
              AND a.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
              AND b.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
            WITH a, b, collect(DISTINCT f.name) AS shared_families
            MATCH (a)-[:HAS_COLOR]->(ca:Color)<-[:HAS_COLOR]-(b)
            WITH a, b, shared_families, collect(DISTINCT ca.name) AS shared_colors
            WHERE size(shared_colors) > 0
            MERGE (a)-[r:SYNERGY]->(b)
            SET r.weight = size(shared_families),
                r.shared_families = shared_families,
                r.shared_colors = shared_colors
            RETURN count(r) AS created
            """
        )
        record = await result.single()
        count = record["created"] if record else 0
        logger.info(f"Created {count} SYNERGY edges")
        return count


async def build_mechanical_synergy_edges(driver: AsyncDriver) -> int:
    """Build MECHANICAL_SYNERGY edges: cards sharing ≥2 parsed keywords."""
    async with driver.session() as session:
        await session.run("MATCH ()-[r:MECHANICAL_SYNERGY]->() DELETE r")

        result = await session.run(
            """
            MATCH (a:Card)-[:HAS_KEYWORD]->(k:Keyword)<-[:HAS_KEYWORD]-(b:Card)
            WHERE a.id < b.id
              AND a.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
              AND b.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
            WITH a, b, collect(DISTINCT k.name) AS shared_keywords
            WHERE size(shared_keywords) >= 2
            MERGE (a)-[r:MECHANICAL_SYNERGY]->(b)
            SET r.weight = size(shared_keywords),
                r.shared_keywords = shared_keywords
            RETURN count(r) AS created
            """
        )
        record = await result.single()
        count = record["created"] if record else 0
        logger.info(f"Created {count} MECHANICAL_SYNERGY edges")
        return count


async def build_curves_into_edges(driver: AsyncDriver) -> int:
    """Build CURVES_INTO edges: same family + color, cost diff 1-2."""
    async with driver.session() as session:
        await session.run("MATCH ()-[r:CURVES_INTO]->() DELETE r")

        result = await session.run(
            """
            MATCH (a:Card)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(b:Card)
            WHERE a.id <> b.id
              AND a.card_type = 'CHARACTER'
              AND b.card_type = 'CHARACTER'
              AND a.cost IS NOT NULL AND b.cost IS NOT NULL
              AND b.cost - a.cost >= 1 AND b.cost - a.cost <= 2
            WITH a, b, collect(DISTINCT f.name) AS shared_families
            MATCH (a)-[:HAS_COLOR]->(ca:Color)<-[:HAS_COLOR]-(b)
            WITH a, b, shared_families
            MERGE (a)-[r:CURVES_INTO]->(b)
            SET r.cost_diff = b.cost - a.cost,
                r.shared_families = shared_families
            RETURN count(r) AS created
            """
        )
        record = await result.single()
        count = record["created"] if record else 0
        logger.info(f"Created {count} CURVES_INTO edges")
        return count


async def build_led_by_edges(driver: AsyncDriver) -> int:
    """Build LED_BY edges: characters → leaders of matching color+family."""
    async with driver.session() as session:
        await session.run("MATCH ()-[r:LED_BY]->() DELETE r")

        result = await session.run(
            """
            MATCH (leader:Card {card_type: 'LEADER'})-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(card:Card)
            WHERE card.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
              AND card.id <> leader.id
            WITH leader, card, collect(DISTINCT f.name) AS shared_families
            MATCH (leader)-[:HAS_COLOR]->(c:Color)<-[:HAS_COLOR]-(card)
            WITH leader, card, shared_families, collect(DISTINCT c.name) AS shared_colors
            WHERE size(shared_colors) > 0
            MERGE (card)-[r:LED_BY]->(leader)
            SET r.synergy_score = toFloat(size(shared_families)) / 3.0,
                r.shared_families = shared_families,
                r.shared_colors = shared_colors
            RETURN count(r) AS created
            """
        )
        record = await result.single()
        count = record["created"] if record else 0
        logger.info(f"Created {count} LED_BY edges")
        return count


async def build_all_edges(driver: AsyncDriver) -> dict[str, int]:
    """Build all computed edges. Returns counts per edge type."""
    results = {}
    results["SYNERGY"] = await build_synergy_edges(driver)
    results["MECHANICAL_SYNERGY"] = await build_mechanical_synergy_edges(driver)
    results["CURVES_INTO"] = await build_curves_into_edges(driver)
    results["LED_BY"] = await build_led_by_edges(driver)
    logger.info(f"All edges built: {results}")
    return results
