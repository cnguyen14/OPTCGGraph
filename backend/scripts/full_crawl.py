"""Run the complete crawl + merge + load pipeline."""

import asyncio
import logging
import sys
from collections import Counter
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(
    0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent)
)

from backend.crawlers.apitcg import crawl_apitcg
from backend.crawlers.optcgapi import crawl_optcgapi
from backend.crawlers.merge import merge_cards
from backend.crawlers.tracer import CrawlTracer
from backend.graph.connection import get_driver, close_driver
from backend.graph.builder import create_indexes, load_cards
from backend.services.settings_service import load_persisted_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    run_id = datetime.now(timezone.utc).strftime("full_crawl_%Y%m%d_%H%M%S")
    tracer = CrawlTracer(run_id)

    tracer.log("pipeline_start", pipeline="full_crawl")
    logger.info(f"=== Starting full crawl pipeline (run={run_id}) ===")

    # Load API keys from Redis (if available)
    await load_persisted_settings()

    # Step 1: Crawl both sources
    tracer.log_step_start("crawl_sources")
    logger.info("--- Step 1: Crawling data sources ---")
    apitcg_cards, optcgapi_cards = await asyncio.gather(
        crawl_apitcg(tracer=tracer),
        crawl_optcgapi(tracer=tracer),
    )
    tracer.log_step_finish(
        "crawl_sources",
        apitcg_count=len(apitcg_cards),
        optcgapi_count=len(optcgapi_cards),
    )
    logger.info(
        f"apitcg: {len(apitcg_cards)} cards, optcgapi: {len(optcgapi_cards)} cards"
    )

    # Step 2: Merge
    tracer.log_step_start("merge")
    logger.info("--- Step 2: Merging cards ---")
    merged = merge_cards(apitcg_cards, optcgapi_cards, tracer=tracer)
    tracer.log_step_finish("merge", total=len(merged))

    # Stats
    type_counts = Counter(c.get("card_type", "UNKNOWN") for c in merged)
    color_counts = Counter(c.get("color", "UNKNOWN") for c in merged)
    logger.info(f"Card types: {dict(type_counts)}")
    logger.info(f"Colors: {dict(color_counts)}")
    tracer.log("merge_stats", card_types=dict(type_counts), colors=dict(color_counts))

    # Step 3: Load into Neo4j
    tracer.log_step_start("neo4j_load")
    logger.info("--- Step 3: Loading into Neo4j ---")
    driver = await get_driver()

    # Clear existing data for clean rebuild
    logger.info("Clearing existing graph data...")
    async with driver.session() as session:
        await session.run("MATCH (n) DETACH DELETE n")
    logger.info("Graph cleared.")

    logger.info("Creating indexes...")
    await create_indexes(driver)

    logger.info("Loading cards...")
    loaded = await load_cards(driver, merged, tracer=tracer)
    tracer.log_step_finish("neo4j_load", loaded=loaded)
    logger.info(f"Loaded {loaded} cards into Neo4j")

    # Step 4: Verify
    tracer.log_step_start("verify")
    logger.info("--- Step 4: Verification ---")
    async with driver.session() as session:
        result = await session.run("MATCH (c:Card) RETURN count(c) AS count")
        record = await result.single()
        card_count = record["count"]
        logger.info(f"Cards in Neo4j: {card_count}")

        result = await session.run(
            "MATCH (c:Card)-[:HAS_COLOR]->(color:Color) "
            "RETURN color.name AS color, count(c) AS count "
            "ORDER BY count DESC"
        )
        records = [r async for r in result]
        color_stats = {r["color"]: r["count"] for r in records}
        for name, cnt in color_stats.items():
            logger.info(f"  {name}: {cnt} cards")

        result = await session.run("MATCH (f:Family) RETURN count(f) AS count")
        record = await result.single()
        family_count = record["count"]
        logger.info(f"Family nodes: {family_count}")

        result = await session.run("MATCH (s:Set) RETURN count(s) AS count")
        record = await result.single()
        set_count = record["count"]
        logger.info(f"Set nodes: {set_count}")

    tracer.log_step_finish(
        "verify",
        cards=card_count,
        colors=color_stats,
        families=family_count,
        sets=set_count,
    )

    await close_driver()

    # Pipeline summary
    summary = tracer.get_summary()
    tracer.log("pipeline_finish", pipeline="full_crawl", steps=summary)
    logger.info(f"=== Full crawl pipeline complete (run={run_id}) ===")
    logger.info(f"Log file: data/logs/crawl/{run_id}.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
