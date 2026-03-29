"""Run ability parser on all cards in Neo4j."""

import asyncio
import logging
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.graph.connection import get_driver, close_driver
from backend.parser.ability_parser import parse_abilities, build_keyword_graph

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    logger.info("=== Starting ability parsing pipeline ===")

    driver = await get_driver()

    # Fetch all cards from Neo4j
    logger.info("Fetching cards from Neo4j...")
    async with driver.session() as session:
        result = await session.run(
            "MATCH (c:Card) RETURN c.id AS id, c.name AS name, c.ability AS ability, c.cost AS cost"
        )
        cards = [dict(record) async for record in result]

    logger.info(f"Found {len(cards)} cards")

    # Parse abilities (uses regex fallback if no API key)
    parsed_results = await parse_abilities(cards)

    # Build keyword graph in Neo4j
    logger.info("Building keyword graph in Neo4j...")
    edges = await build_keyword_graph(driver, parsed_results, cards)
    logger.info(f"Created {edges} keyword/cost-tier edges")

    # Verify
    async with driver.session() as session:
        result = await session.run("MATCH (k:Keyword) RETURN count(k) AS count")
        record = await result.single()
        logger.info(f"Keyword nodes: {record['count']}")

        result = await session.run("MATCH ()-[r:HAS_KEYWORD]->() RETURN count(r) AS count")
        record = await result.single()
        logger.info(f"HAS_KEYWORD edges: {record['count']}")

        result = await session.run("MATCH (t:CostTier) RETURN count(t) AS count")
        record = await result.single()
        logger.info(f"CostTier nodes: {record['count']}")

        result = await session.run("MATCH ()-[r:IN_COST_TIER]->() RETURN count(r) AS count")
        record = await result.single()
        logger.info(f"IN_COST_TIER edges: {record['count']}")

    await close_driver()
    logger.info("=== Ability parsing complete ===")


if __name__ == "__main__":
    asyncio.run(main())
