"""Crawl tournament deck data from Limitless TCG and load into Neo4j."""

import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    from backend.crawlers.limitlesstcg import crawl_limitlesstcg
    from backend.crawlers.tracer import CrawlTracer
    from backend.graph.connection import get_driver, close_driver
    from backend.graph.builder import (
        create_meta_indexes,
        load_tournament_data,
        compute_card_meta_stats,
    )
    from backend.services.settings_service import load_persisted_settings

    run_id = datetime.now(timezone.utc).strftime("crawl_decks_%Y%m%d_%H%M%S")
    tracer = CrawlTracer(run_id)

    tracer.log("pipeline_start", pipeline="crawl_decks")
    logger.info(f"=== Starting deck crawl pipeline (run={run_id}) ===")

    await load_persisted_settings()

    # 1. Crawl
    tracer.log_step_start("crawl_limitlesstcg")
    logger.info("Starting Limitless TCG crawl...")
    data = await crawl_limitlesstcg(max_tournaments=15, top_n=16, tracer=tracer)
    tracer.log_step_finish(
        "crawl_limitlesstcg",
        tournaments=len(data["tournaments"]),
        decks=len(data["decks"]),
    )
    logger.info(
        f"Crawled {len(data['tournaments'])} tournaments, {len(data['decks'])} decks"
    )

    # 2. Load into Neo4j
    driver = await get_driver()

    tracer.log_step_start("create_meta_indexes")
    logger.info("Creating meta indexes...")
    await create_meta_indexes(driver)
    tracer.log_step_finish("create_meta_indexes")

    tracer.log_step_start("load_tournament_data")
    logger.info("Loading tournament data into Neo4j...")
    stats = await load_tournament_data(
        driver, data["tournaments"], data["decks"], tracer=tracer
    )
    tracer.log_step_finish("load_tournament_data", **stats)
    logger.info(f"Loaded: {stats}")

    # 3. Compute meta stats on cards
    tracer.log_step_start("compute_meta_stats")
    logger.info("Computing card meta stats...")
    updated = await compute_card_meta_stats(driver, tracer=tracer)
    tracer.log_step_finish("compute_meta_stats", cards_updated=updated)
    logger.info(f"Updated meta stats for {updated} cards")

    # 4. Verify
    tracer.log_step_start("verify")
    async with driver.session() as session:
        result = await session.run("MATCH (t:Tournament) RETURN count(t) AS cnt")
        record = await result.single()
        t_count = record["cnt"]
        logger.info(f"Tournaments in graph: {t_count}")

        result = await session.run("MATCH (d:Deck) RETURN count(d) AS cnt")
        record = await result.single()
        d_count = record["cnt"]
        logger.info(f"Decks in graph: {d_count}")

        result = await session.run(
            "MATCH (c:Card) WHERE c.tournament_pick_rate > 0 RETURN count(c) AS cnt"
        )
        record = await result.single()
        meta_count = record["cnt"]
        logger.info(f"Cards with meta stats: {meta_count}")

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
        top_cards = []
        logger.info("Top 10 most picked cards:")
        async for r in result:
            logger.info(
                f"  {r['id']} {r['name']} — pick_rate={r['pick_rate']}, "
                f"avg_copies={r['avg_copies']}"
            )
            top_cards.append(
                {"id": r["id"], "name": r["name"], "pick_rate": r["pick_rate"]}
            )

    tracer.log_step_finish(
        "verify",
        tournaments=t_count,
        decks=d_count,
        cards_with_meta=meta_count,
        top_cards=top_cards[:5],
    )

    await close_driver()

    summary = tracer.get_summary()
    tracer.log("pipeline_finish", pipeline="crawl_decks", steps=summary)
    logger.info(f"=== Deck crawl complete (run={run_id}) ===")
    logger.info(f"Log file: data/logs/crawl/{run_id}.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
