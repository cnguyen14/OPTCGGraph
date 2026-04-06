"""Compute synergy, mechanical, and strategic edges in the knowledge graph.

All edge builders process cards in batches to stay within Neo4j Community's
1.3 GiB transaction memory limit. Each batch limits the Cartesian product
to CHUNK_SIZE × relationships instead of ALL_CARDS × relationships.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from neo4j import AsyncDriver

if TYPE_CHECKING:
    from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)

EDGE_CHUNK_SIZE = 300  # Cards per batch for edge computation


async def _get_card_ids(driver: AsyncDriver) -> list[str]:
    """Get all card IDs for batched processing."""
    async with driver.session() as session:
        result = await session.run(
            "MATCH (c:Card) WHERE c.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE'] "
            "RETURN c.id AS id ORDER BY c.id"
        )
        return [record["id"] async for record in result]


async def build_synergy_edges(driver: AsyncDriver) -> int:
    """Build SYNERGY edges: cards sharing ≥1 family within same color.

    Batched by card ID chunks to avoid memory overflow.
    """
    # Delete existing edges
    async with driver.session() as session:
        await session.run("MATCH ()-[r:SYNERGY]->() DELETE r")

    card_ids = await _get_card_ids(driver)
    total = 0

    for i in range(0, len(card_ids), EDGE_CHUNK_SIZE):
        chunk = card_ids[i : i + EDGE_CHUNK_SIZE]
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (a:Card)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(b:Card)
                WHERE a.id IN $chunk_ids AND a.id < b.id
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
                """,
                chunk_ids=chunk,
            )
            record = await result.single()
            batch_count = record["created"] if record else 0
            total += batch_count

        if i % (EDGE_CHUNK_SIZE * 3) == 0 and i > 0:
            logger.info("  SYNERGY progress: %d/%d cards, %d edges", i, len(card_ids), total)

    logger.info("Created %d SYNERGY edges", total)
    return total


async def build_mechanical_synergy_edges(driver: AsyncDriver) -> int:
    """Build MECHANICAL_SYNERGY edges: cards sharing ≥2 keywords within same color.

    Batched to avoid Cartesian product explosion (keywords have high cardinality).
    """
    async with driver.session() as session:
        await session.run("MATCH ()-[r:MECHANICAL_SYNERGY]->() DELETE r")

    card_ids = await _get_card_ids(driver)
    total = 0

    for i in range(0, len(card_ids), EDGE_CHUNK_SIZE):
        chunk = card_ids[i : i + EDGE_CHUNK_SIZE]
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (a:Card)-[:HAS_KEYWORD]->(k:Keyword)<-[:HAS_KEYWORD]-(b:Card)
                WHERE a.id IN $chunk_ids AND a.id < b.id
                  AND b.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
                WITH a, b, collect(DISTINCT k.name) AS shared_keywords
                WHERE size(shared_keywords) >= 2
                MATCH (a)-[:HAS_COLOR]->(ca:Color)<-[:HAS_COLOR]-(b)
                WITH a, b, shared_keywords
                MERGE (a)-[r:MECHANICAL_SYNERGY]->(b)
                SET r.weight = size(shared_keywords),
                    r.shared_keywords = shared_keywords
                RETURN count(r) AS created
                """,
                chunk_ids=chunk,
            )
            record = await result.single()
            batch_count = record["created"] if record else 0
            total += batch_count

        if i % (EDGE_CHUNK_SIZE * 3) == 0 and i > 0:
            logger.info("  MECHANICAL_SYNERGY progress: %d/%d cards, %d edges", i, len(card_ids), total)

    logger.info("Created %d MECHANICAL_SYNERGY edges", total)
    return total


async def build_curves_into_edges(driver: AsyncDriver) -> int:
    """Build CURVES_INTO edges: same family + color, cost diff 1-2.

    Batched by card chunks.
    """
    async with driver.session() as session:
        await session.run("MATCH ()-[r:CURVES_INTO]->() DELETE r")

    card_ids = await _get_card_ids(driver)
    total = 0

    for i in range(0, len(card_ids), EDGE_CHUNK_SIZE):
        chunk = card_ids[i : i + EDGE_CHUNK_SIZE]
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (a:Card)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(b:Card)
                WHERE a.id IN $chunk_ids
                  AND a.card_type = 'CHARACTER' AND b.card_type = 'CHARACTER'
                  AND a.cost IS NOT NULL AND b.cost IS NOT NULL
                  AND b.cost - a.cost >= 1 AND b.cost - a.cost <= 2
                WITH a, b, collect(DISTINCT f.name) AS shared_families
                MATCH (a)-[:HAS_COLOR]->(ca:Color)<-[:HAS_COLOR]-(b)
                WITH a, b, shared_families
                MERGE (a)-[r:CURVES_INTO]->(b)
                SET r.cost_diff = b.cost - a.cost,
                    r.shared_families = shared_families
                RETURN count(r) AS created
                """,
                chunk_ids=chunk,
            )
            record = await result.single()
            total += record["created"] if record else 0

    logger.info("Created %d CURVES_INTO edges", total)
    return total


async def build_led_by_edges(driver: AsyncDriver) -> int:
    """Build LED_BY edges: characters → leaders of matching color+family.

    Batched by leader (leaders are few ~200, so batch by leader chunks).
    """
    async with driver.session() as session:
        await session.run("MATCH ()-[r:LED_BY]->() DELETE r")

    # Get leader IDs
    async with driver.session() as session:
        result = await session.run(
            "MATCH (c:Card {card_type: 'LEADER'}) RETURN c.id AS id ORDER BY c.id"
        )
        leader_ids = [record["id"] async for record in result]

    total = 0
    for i in range(0, len(leader_ids), 50):  # 50 leaders per batch
        chunk = leader_ids[i : i + 50]
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (leader:Card)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(card:Card)
                WHERE leader.id IN $chunk_ids AND leader.card_type = 'LEADER'
                  AND card.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
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
                """,
                chunk_ids=chunk,
            )
            record = await result.single()
            total += record["created"] if record else 0

    logger.info("Created %d LED_BY edges", total)
    return total


async def build_all_edges(
    driver: AsyncDriver, tracer: CrawlTracer | None = None
) -> dict[str, int]:
    """Build all computed edges. Returns counts per edge type."""
    t0 = time.time()
    if tracer:
        tracer.log("neo4j_start", step="build_all_edges")

    results = {}
    for name, fn in [
        ("SYNERGY", build_synergy_edges),
        ("MECHANICAL_SYNERGY", build_mechanical_synergy_edges),
        ("CURVES_INTO", build_curves_into_edges),
        ("LED_BY", build_led_by_edges),
    ]:
        et = time.time()
        logger.info("Building %s edges (batched)...", name)
        results[name] = await fn(driver)
        edge_ms = round((time.time() - et) * 1000, 1)
        logger.info("  %s: %d edges in %.1fs", name, results[name], edge_ms / 1000)
        if tracer:
            tracer.log(
                "edge_built",
                edge_type=name,
                count=results[name],
                latency_ms=edge_ms,
            )
        # Brief pause between edge types
        await asyncio.sleep(1)

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info("All edges built: %s (%.1fs)", results, latency_ms / 1000)
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="build_all_edges",
            total=sum(results.values()),
            by_type=results,
            latency_ms=latency_ms,
        )
    return results
