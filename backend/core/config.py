"""Type-safe application configuration via pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    # Neo4j
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "optcg_graph_2026"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # LLM Providers
    anthropic_api_key: str = ""
    openrouter_api_key: str = ""
    default_provider: str = "anthropic"
    default_model: str = "claude-sonnet-4-20250514"

    # Data Sources
    apitcg_api_key: str = ""
    apitcg_base_url: str = "https://www.apitcg.com/api/one-piece/cards"
    optcgapi_base_url: str = "https://optcgapi.com/api"
    limitlesstcg_base_url: str = "https://onepiece.limitlesstcg.com"

    # Crawl settings
    apitcg_delay: float = 1.0
    optcgapi_delay: float = 1.5
    limitlesstcg_delay: float = 2.0

    # Paths
    crawl_cache_dir: Path = Path(__file__).resolve().parent.parent.parent / ".crawl-cache"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent.parent / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance. Validated once at first access."""
    return Settings()
