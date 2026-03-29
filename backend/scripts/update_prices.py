"""Update pricing data from optcgapi without full re-crawl."""

import asyncio
import logging
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.crawlers.optcgapi import crawl_optcgapi
from backend.graph.connection import get_driver, close_driver

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    logger.info("=== Starting price update ===")

    cards = await crawl_optcgapi()
    driver = await get_driver()

    updated = 0
    async with driver.session() as session:
        for card in cards:
            if card.get("market_price") is not None:
                await session.run(
                    """
                    MATCH (c:Card {id: $id})
                    SET c.market_price = $market_price,
                        c.inventory_price = $inventory_price
                    """,
                    id=card["id"],
                    market_price=card.get("market_price"),
                    inventory_price=card.get("inventory_price"),
                )
                updated += 1

    logger.info(f"Updated prices for {updated} cards")
    await close_driver()
    logger.info("=== Price update complete ===")


if __name__ == "__main__":
    asyncio.run(main())
