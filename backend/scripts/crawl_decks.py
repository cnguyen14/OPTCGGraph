"""Crawl tournament deck data from Limitless TCG and load into Neo4j."""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    from backend.crawlers.limitlesstcg import crawl_limitlesstcg
    from backend.graph.connection import get_driver, close_driver
    from backend.graph.builder import (
        create_meta_indexes,
        load_tournament_data,
        compute_card_meta_stats,
    )

    # 1. Crawl
    logger.info("Starting Limitless TCG crawl...")
    data = await crawl_limitlesstcg(max_tournaments=15, top_n=16)
    logger.info(
        f"Crawled {len(data['tournaments'])} tournaments, {len(data['decks'])} decks"
    )

    # 2. Load into Neo4j
    driver = await get_driver()

    logger.info("Creating meta indexes...")
    await create_meta_indexes(driver)

    logger.info("Loading tournament data into Neo4j...")
    stats = await load_tournament_data(driver, data["tournaments"], data["decks"])
    logger.info(f"Loaded: {stats}")

    # 3. Compute meta stats on cards
    logger.info("Computing card meta stats...")
    updated = await compute_card_meta_stats(driver)
    logger.info(f"Updated meta stats for {updated} cards")

    # 4. Verify
    async with driver.session() as session:
        result = await session.run("MATCH (t:Tournament) RETURN count(t) AS cnt")
        record = await result.single()
        logger.info(f"Tournaments in graph: {record['cnt']}")

        result = await session.run("MATCH (d:Deck) RETURN count(d) AS cnt")
        record = await result.single()
        logger.info(f"Decks in graph: {record['cnt']}")

        result = await session.run(
            "MATCH (c:Card) WHERE c.tournament_pick_rate > 0 RETURN count(c) AS cnt"
        )
        record = await result.single()
        logger.info(f"Cards with meta stats: {record['cnt']}")

        # Top picked cards
        result = await session.run(
            """
            MATCH (c:Card)
            WHERE c.tournament_pick_rate > 0
            RETURN c.id AS id, c.name AS name,
                   round(c.tournament_pick_rate * 100) / 100 AS pick_rate,
                   c.avg_copies AS avg_copies
            ORDER BY c.tournament_pick_rate DESC
            LIMIT 10
            """
        )
        logger.info("Top 10 most picked cards:")
        async for r in result:
            logger.info(
                f"  {r['id']} {r['name']} — pick_rate={r['pick_rate']}, "
                f"avg_copies={r['avg_copies']}"
            )

    await close_driver()
    logger.info("Done!")


if __name__ == "__main__":
    asyncio.run(main())
