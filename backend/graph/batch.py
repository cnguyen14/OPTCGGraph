"""Batch UNWIND utilities for high-performance Neo4j writes."""

import logging
from collections.abc import Iterator

from neo4j import AsyncDriver

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 200
RELATIONSHIP_CHUNK_SIZE = 500


def chunk(items: list, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[list]:
    """Yield successive chunks from a list."""
    for i in range(0, len(items), size):
        yield items[i : i + size]


async def batch_write(
    driver: AsyncDriver,
    cypher: str,
    items: list[dict],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    label: str = "",
) -> int:
    """Execute UNWIND $batch AS row ... in chunks.

    Args:
        driver: Neo4j async driver
        cypher: Cypher query starting with UNWIND $batch AS row ...
        items: List of dicts, each dict becomes a row
        chunk_size: Items per transaction
        label: Optional label for progress logging

    Returns:
        Total number of items processed.
    """
    if not items:
        return 0

    total = len(items)
    processed = 0

    async with driver.session() as session:
        for batch in chunk(items, chunk_size):
            await session.run(cypher, batch=batch)
            processed += len(batch)

            if label and total > chunk_size:
                logger.info(f"  {label}: {processed}/{total}")

    return processed
