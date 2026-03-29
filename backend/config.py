"""Application configuration loaded from environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")


# Data Sources
APITCG_API_KEY: str = os.getenv("APITCG_API_KEY", "")
APITCG_BASE_URL: str = "https://apitcg.com/api/one-piece/cards"

OPTCGAPI_BASE_URL: str = "https://optcgapi.com/api"

# Neo4j
NEO4J_URI: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER: str = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "optcg_graph_2026")

# Redis
REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

# LLM Providers
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
DEFAULT_PROVIDER: str = os.getenv("DEFAULT_PROVIDER", "claude")
DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514")

# Crawl settings
CRAWL_CACHE_DIR: Path = _project_root / ".crawl-cache"
APITCG_DELAY: float = 1.0  # seconds between requests
OPTCGAPI_DELAY: float = 1.5
