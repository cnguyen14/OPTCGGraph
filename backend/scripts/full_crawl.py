"""Run the complete crawl + merge + load pipeline."""

import asyncio
import logging
import sys
from collections import Counter

# Add project root to path
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.crawlers.apitcg import crawl_apitcg
from backend.crawlers.optcgapi import crawl_optcgapi
from backend.crawlers.merge import merge_cards
from backend.graph.connection import get_driver, close_driver
from backend.graph.builder import create_indexes, load_cards

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    logger.info("=== Starting full crawl pipeline ===")

    # Step 1: Crawl both sources
    logger.info("--- Step 1: Crawling data sources ---")
    apitcg_cards, optcgapi_cards = await asyncio.gather(
        crawl_apitcg(),
        crawl_optcgapi(),
    )
    logger.info(f"apitcg: {len(apitcg_cards)} cards, optcgapi: {len(optcgapi_cards)} cards")

    # Step 2: Merge
    logger.info("--- Step 2: Merging cards ---")
    merged = merge_cards(apitcg_cards, optcgapi_cards)

    # Stats
    type_counts = Counter(c.get("card_type", "UNKNOWN") for c in merged)
    color_counts = Counter(c.get("color", "UNKNOWN") for c in merged)
    logger.info(f"Card types: {dict(type_counts)}")
    logger.info(f"Colors: {dict(color_counts)}")

    # Step 3: Load into Neo4j
    logger.info("--- Step 3: Loading into Neo4j ---")
    driver = await get_driver()

    logger.info("Creating indexes...")
    await create_indexes(driver)

    logger.info("Loading cards...")
    loaded = await load_cards(driver, merged)
    logger.info(f"Loaded {loaded} cards into Neo4j")

    # Step 4: Verify
    logger.info("--- Step 4: Verification ---")
    async with driver.session() as session:
        result = await session.run("MATCH (c:Card) RETURN count(c) AS count")
        record = await result.single()
        logger.info(f"Cards in Neo4j: {record['count']}")

        result = await session.run(
            "MATCH (c:Card)-[:HAS_COLOR]->(color:Color) "
            "RETURN color.name AS color, count(c) AS count "
            "ORDER BY count DESC"
        )
        records = [r async for r in result]
        for r in records:
            logger.info(f"  {r['color']}: {r['count']} cards")

        result = await session.run("MATCH (f:Family) RETURN count(f) AS count")
        record = await result.single()
        logger.info(f"Family nodes: {record['count']}")

        result = await session.run("MATCH (s:Set) RETURN count(s) AS count")
        record = await result.single()
        logger.info(f"Set nodes: {record['count']}")

    await close_driver()
    logger.info("=== Full crawl pipeline complete ===")


if __name__ == "__main__":
    asyncio.run(main())
