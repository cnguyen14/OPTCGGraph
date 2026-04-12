"""Run ability parser on all cards in Neo4j."""

import asyncio
import logging
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.crawlers.tracer import CrawlTracer
from backend.graph.connection import close_driver, get_driver
from backend.parser.ability_parser import build_keyword_graph, parse_abilities
from backend.services.settings_service import load_persisted_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    run_id = datetime.now(timezone.utc).strftime("parse_abilities_%Y%m%d_%H%M%S")
    tracer = CrawlTracer(run_id)

    tracer.log("pipeline_start", pipeline="parse_abilities")
    logger.info(f"=== Starting ability parsing pipeline (run={run_id}) ===")

    await load_persisted_settings()
    driver = await get_driver()

    # Fetch all cards from Neo4j
    tracer.log_step_start("fetch_cards")
    logger.info("Fetching cards from Neo4j...")
    async with driver.session() as session:
        result = await session.run(
            "MATCH (c:Card) RETURN c.id AS id, c.name AS name, c.ability AS ability, c.cost AS cost"
        )
        cards = [dict(record) async for record in result]
    tracer.log_step_finish("fetch_cards", card_count=len(cards))
    logger.info(f"Found {len(cards)} cards")

    # Parse abilities (uses regex fallback if no API key)
    tracer.log_step_start("parse_abilities")
    parsed_results = await parse_abilities(cards, tracer=tracer)
    tracer.log_step_finish("parse_abilities", parsed_count=len(parsed_results))

    # Build keyword graph in Neo4j
    tracer.log_step_start("build_keyword_graph")
    logger.info("Building keyword graph in Neo4j...")
    edges = await build_keyword_graph(driver, parsed_results, cards, tracer=tracer)
    tracer.log_step_finish("build_keyword_graph", edges_created=edges)
    logger.info(f"Created {edges} keyword/cost-tier edges")

    # Verify
    tracer.log_step_start("verify")
    async with driver.session() as session:
        result = await session.run("MATCH (k:Keyword) RETURN count(k) AS count")
        record = await result.single()
        kw_count = record["count"]
        logger.info(f"Keyword nodes: {kw_count}")

        result = await session.run("MATCH ()-[r:HAS_KEYWORD]->() RETURN count(r) AS count")
        record = await result.single()
        hk_count = record["count"]
        logger.info(f"HAS_KEYWORD edges: {hk_count}")

        result = await session.run("MATCH (t:CostTier) RETURN count(t) AS count")
        record = await result.single()
        ct_count = record["count"]
        logger.info(f"CostTier nodes: {ct_count}")

        result = await session.run("MATCH ()-[r:IN_COST_TIER]->() RETURN count(r) AS count")
        record = await result.single()
        ict_count = record["count"]
        logger.info(f"IN_COST_TIER edges: {ict_count}")

    tracer.log_step_finish(
        "verify",
        keywords=kw_count,
        has_keyword_edges=hk_count,
        cost_tiers=ct_count,
        in_cost_tier_edges=ict_count,
    )

    await close_driver()

    summary = tracer.get_summary()
    tracer.log("pipeline_finish", pipeline="parse_abilities", steps=summary)
    logger.info(f"=== Ability parsing complete (run={run_id}) ===")
    logger.info(f"Log file: data/logs/crawl/{run_id}.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
