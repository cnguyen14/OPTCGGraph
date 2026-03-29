"""Rebuild all computed edges in the knowledge graph."""

import asyncio
import logging
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from backend.graph.connection import get_driver, close_driver
from backend.graph.edges import build_all_edges

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    logger.info("=== Rebuilding computed edges ===")
    driver = await get_driver()
    results = await build_all_edges(driver)

    total = sum(results.values())
    logger.info(f"Total edges created: {total}")
    for edge_type, count in results.items():
        logger.info(f"  {edge_type}: {count}")

    await close_driver()
    logger.info("=== Edge rebuild complete ===")


if __name__ == "__main__":
    asyncio.run(main())
