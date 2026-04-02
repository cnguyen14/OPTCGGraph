"""Shared FastAPI dependencies — eliminates duplicate _get_driver() functions."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from neo4j import AsyncDriver

from backend.core.config import Settings, get_settings
from backend.graph.connection import get_driver
from backend.storage.redis_client import get_redis


async def get_driver_dep() -> AsyncDriver:
    """Dependency that provides the Neo4j async driver."""
    return await get_driver()


async def get_redis_dep():
    """Dependency that provides the Redis async client."""
    return await get_redis()


def get_settings_dep() -> Settings:
    """Dependency that provides the application settings."""
    return get_settings()


# Annotated type aliases for clean route signatures
Driver = Annotated[AsyncDriver, Depends(get_driver_dep)]
Redis = Annotated[object, Depends(get_redis_dep)]
AppSettings = Annotated[Settings, Depends(get_settings_dep)]
