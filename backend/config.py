"""Application configuration — re-export shim.

All configuration now lives in backend.core.config (pydantic-settings).
This file re-exports values so existing imports continue to work.
"""

from backend.core.config import get_settings as _get_settings

_s = _get_settings()

# Data Sources
APITCG_API_KEY: str = _s.apitcg_api_key
APITCG_BASE_URL: str = _s.apitcg_base_url
OPTCGAPI_BASE_URL: str = _s.optcgapi_base_url
OPTCGAPI_DELAY: float = _s.optcgapi_delay
LIMITLESSTCG_BASE_URL: str = _s.limitlesstcg_base_url
LIMITLESSTCG_DELAY: float = _s.limitlesstcg_delay
APITCG_DELAY: float = _s.apitcg_delay

# Neo4j
NEO4J_URI: str = _s.neo4j_uri
NEO4J_USER: str = _s.neo4j_user
NEO4J_PASSWORD: str = _s.neo4j_password

# Redis
REDIS_URL: str = _s.redis_url

# LLM Providers
ANTHROPIC_API_KEY: str = _s.anthropic_api_key
OPENROUTER_API_KEY: str = _s.openrouter_api_key
DEFAULT_PROVIDER: str = _s.default_provider
DEFAULT_MODEL: str = _s.default_model

# Crawl settings
CRAWL_CACHE_DIR = _s.crawl_cache_dir
