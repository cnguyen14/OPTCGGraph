"""Settings service — model config, BYOK key management.

Extracted from routes_settings.py to fix the architectural violation of
get_active_api_key() living in a route file and being imported cross-module.
"""

from __future__ import annotations

import json
import logging

import anthropic
import httpx

from backend.core.config import get_settings
from backend.storage.redis_client import get_redis

logger = logging.getLogger(__name__)

# In-memory state (per-process)
_current_settings: dict = {}
_runtime_keys: dict[str, str] = {}

AVAILABLE_MODELS = {
    "claude": [
        {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "tier": 1},
        {"id": "claude-opus-4-20250514", "name": "Claude Opus 4", "tier": 1},
    ],
    "openrouter": [
        {"id": "openai/gpt-4o", "name": "GPT-4o", "tier": 1},
        {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash", "tier": 2},
        {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B", "tier": 2},
        {"id": "mistralai/mistral-large-latest", "name": "Mistral Large", "tier": 2},
    ],
}


def _ensure_defaults() -> None:
    """Lazy-init current settings from config on first use."""
    if not _current_settings:
        s = get_settings()
        _current_settings["provider"] = s.default_provider
        _current_settings["model"] = s.default_model


def get_active_api_key(provider: str) -> str:
    """Get the active API key for a provider from Redis-persisted runtime keys."""
    if provider == "claude":
        return _runtime_keys.get("anthropic", "")
    elif provider == "openrouter":
        return _runtime_keys.get("openrouter", "")
    elif provider == "apitcg":
        return _runtime_keys.get("apitcg", "")
    return ""


def get_current_model_config() -> dict:
    """Get current provider + model selection."""
    _ensure_defaults()
    return dict(_current_settings)


def switch_model(provider: str, model: str) -> dict:
    """Switch the active provider and model — in-memory only."""
    _ensure_defaults()
    _current_settings["provider"] = provider
    _current_settings["model"] = model
    return dict(_current_settings)


async def switch_model_async(provider: str, model: str) -> dict:
    """Switch the active provider and model, persist to Redis."""
    _ensure_defaults()
    _current_settings["provider"] = provider
    _current_settings["model"] = model
    try:
        r = await get_redis()
        await r.set("settings:model_config", json.dumps(_current_settings))
    except Exception:
        logger.warning("Failed to persist model config to Redis", exc_info=True)
    return dict(_current_settings)


def set_runtime_key(provider: str, api_key: str) -> None:
    """Set a runtime API key (BYOK) — in-memory only. Use async version to persist."""
    _runtime_keys[provider] = api_key
    logger.info("Runtime API key set for provider: %s", provider)


async def set_runtime_key_async(provider: str, api_key: str) -> None:
    """Set a runtime API key and persist to Redis."""
    _runtime_keys[provider] = api_key
    logger.info("Runtime API key set for provider: %s", provider)
    try:
        r = await get_redis()
        await r.set("settings:runtime_keys", json.dumps(_runtime_keys))
    except Exception:
        logger.warning("Failed to persist runtime key to Redis", exc_info=True)


def clear_runtime_key(provider: str) -> bool:
    """Clear a runtime API key. Returns True if one was removed."""
    return _runtime_keys.pop(provider, None) is not None


async def clear_runtime_key_async(provider: str) -> bool:
    """Clear a runtime API key and persist to Redis."""
    removed = _runtime_keys.pop(provider, None) is not None
    try:
        r = await get_redis()
        await r.set("settings:runtime_keys", json.dumps(_runtime_keys))
    except Exception:
        logger.warning("Failed to persist runtime key removal to Redis", exc_info=True)
    return removed


def has_runtime_key(provider: str) -> bool:
    """Check if a runtime key is set for a provider."""
    return bool(_runtime_keys.get(provider))


def list_models() -> dict:
    """List current config and available models."""
    _ensure_defaults()
    return {
        "current": dict(_current_settings),
        "available": AVAILABLE_MODELS,
    }


async def test_api_key(provider: str, api_key: str) -> dict:
    """Test if an API key is valid by making a minimal API call."""
    if provider == "anthropic":
        try:
            client = anthropic.AsyncAnthropic(api_key=api_key, timeout=15.0)
            resp = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=10,
                messages=[{"role": "user", "content": "Hi"}],
            )
            return {"valid": True, "model": resp.model}
        except anthropic.AuthenticationError:
            return {"valid": False, "error": "Invalid API key"}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    elif provider == "openrouter":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if resp.status_code == 401:
                    return {"valid": False, "error": "Invalid API key"}
                return {"valid": True, "models_count": len(resp.json().get("data", []))}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    return {"valid": False, "error": f"Unknown provider: {provider}"}


async def load_persisted_settings() -> None:
    """Load runtime keys and model config from Redis on startup."""
    try:
        r = await get_redis()

        raw_keys = await r.get("settings:runtime_keys")
        if raw_keys:
            data = json.loads(raw_keys if isinstance(raw_keys, str) else raw_keys.decode())
            _runtime_keys.update(data)
            logger.info("Restored %d runtime API key(s) from Redis", len(data))

        raw_config = await r.get("settings:model_config")
        if raw_config:
            data = json.loads(raw_config if isinstance(raw_config, str) else raw_config.decode())
            _current_settings.update(data)
            logger.info("Restored model config from Redis: %s", data)
    except Exception:
        logger.warning("Failed to load persisted settings from Redis", exc_info=True)
