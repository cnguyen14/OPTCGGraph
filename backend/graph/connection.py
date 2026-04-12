"""Neo4j async driver connection management."""

from neo4j import AsyncDriver, AsyncGraphDatabase

from backend.config import NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER

_driver: AsyncDriver | None = None


async def get_driver() -> AsyncDriver:
    """Get or create the Neo4j async driver (singleton)."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            max_connection_pool_size=50,
        )
    return _driver


async def close_driver() -> None:
    """Close the Neo4j driver."""
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def verify_connection() -> bool:
    """Verify Neo4j is reachable."""
    driver = await get_driver()
    try:
        await driver.verify_connectivity()
        return True
    except Exception:
        return False
