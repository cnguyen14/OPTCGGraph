"""Rebuild all computed edges in the knowledge graph."""

import asyncio
import logging
import sys
from datetime import datetime, timezone

sys.path.insert(
    0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent)
)

from backend.crawlers.tracer import CrawlTracer
from backend.graph.connection import get_driver, close_driver
from backend.graph.edges import build_all_edges

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    run_id = datetime.now(timezone.utc).strftime("rebuild_edges_%Y%m%d_%H%M%S")
    tracer = CrawlTracer(run_id)

    tracer.log("pipeline_start", pipeline="rebuild_edges")
    logger.info(f"=== Rebuilding computed edges (run={run_id}) ===")

    driver = await get_driver()

    tracer.log_step_start("build_all_edges")
    results = await build_all_edges(driver, tracer=tracer)
    tracer.log_step_finish("build_all_edges", **results)

    total = sum(results.values())
    logger.info(f"Total edges created: {total}")
    for edge_type, count in results.items():
        logger.info(f"  {edge_type}: {count}")

    await close_driver()

    summary = tracer.get_summary()
    tracer.log("pipeline_finish", pipeline="rebuild_edges", steps=summary)
    logger.info(f"=== Edge rebuild complete (run={run_id}) ===")
    logger.info(f"Log file: data/logs/crawl/{run_id}.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
