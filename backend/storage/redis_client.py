"""Async Redis client singleton."""

import logging

import redis.asyncio as redis

from backend.config import REDIS_URL

logger = logging.getLogger(__name__)

_client: redis.Redis | None = None  # type: ignore[type-arg]


async def get_redis() -> redis.Redis:  # type: ignore[type-arg]
    """Get or create the async Redis client."""
    global _client
    if _client is None:
        _client = redis.from_url(REDIS_URL, decode_responses=True)
        logger.info(f"Redis client created for {REDIS_URL}")
    return _client


async def close_redis() -> None:
    """Close the Redis connection."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
        logger.info("Redis client closed")


async def verify_redis() -> bool:
    """Check if Redis is reachable."""
    try:
        r = await get_redis()
        await r.ping()
        return True
    except Exception:
        return False
