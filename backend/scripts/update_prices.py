"""Update pricing data from optcgapi without full re-crawl."""

import asyncio
import logging
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.crawlers.optcgapi import crawl_optcgapi
from backend.crawlers.tracer import CrawlTracer
from backend.graph.batch import batch_write
from backend.graph.connection import close_driver, get_driver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    run_id = datetime.now(timezone.utc).strftime("update_prices_%Y%m%d_%H%M%S")
    tracer = CrawlTracer(run_id)

    tracer.log("pipeline_start", pipeline="update_prices")
    logger.info(f"=== Starting price update (run={run_id}) ===")

    tracer.log_step_start("crawl_prices")
    cards = await crawl_optcgapi(tracer=tracer)
    tracer.log_step_finish("crawl_prices", total_cards=len(cards))

    driver = await get_driver()

    # Filter cards with pricing data and batch update
    tracer.log_step_start("update_neo4j")
    t0 = time.time()
    price_params = [
        {
            "id": card["id"],
            "market_price": card.get("market_price"),
            "inventory_price": card.get("inventory_price"),
        }
        for card in cards
        if card.get("market_price") is not None
    ]

    updated = await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (c:Card {id: row.id})
        SET c.market_price = row.market_price,
            c.inventory_price = row.inventory_price
        """,
        price_params,
        label="Price updates",
    )
    latency_ms = round((time.time() - t0) * 1000, 1)
    tracer.log_step_finish("update_neo4j", updated=updated, latency_ms=latency_ms)

    logger.info(f"Updated prices for {updated} cards")
    await close_driver()

    summary = tracer.get_summary()
    tracer.log("pipeline_finish", pipeline="update_prices", steps=summary)
    logger.info(f"=== Price update complete (run={run_id}) ===")
    logger.info(f"Log file: data/logs/crawl/{run_id}.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
