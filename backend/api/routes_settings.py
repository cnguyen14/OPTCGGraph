"""Settings API endpoints — includes BYOK (Bring Your Own Key) support."""

import logging

import anthropic
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from backend.api.models import ModelSwitchRequest
from backend.config import NEO4J_URI, REDIS_URL
from backend.graph.connection import verify_connection
from backend.services.settings_service import (
    get_active_api_key,
    has_runtime_key,
    list_models as list_models_service,
    set_runtime_key_async,
    clear_runtime_key_async,
    switch_model_async,
)
from backend.storage.redis_client import verify_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

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


@router.get("/models")
async def get_models():
    return list_models_service()


@router.put("/model")
async def do_switch_model(req: ModelSwitchRequest):
    current = await switch_model_async(req.provider, req.model)
    return {"status": "ok", "current": current}


# --- BYOK Endpoints ---


class ApiKeyRequest(BaseModel):
    provider: str  # "anthropic" or "openrouter"
    api_key: str


class TestKeyRequest(BaseModel):
    provider: str
    api_key: str


@router.put("/api-key")
async def save_api_key(req: ApiKeyRequest):
    """Save a runtime API key (overrides env var), persisted to Redis."""
    if req.provider not in ("anthropic", "openrouter", "apitcg"):
        return {"status": "error", "message": f"Unknown provider: {req.provider}"}
    await set_runtime_key_async(req.provider, req.api_key)
    return {"status": "ok", "provider": req.provider}


@router.delete("/api-key/{provider}")
async def remove_api_key(provider: str):
    """Remove a runtime API key (fall back to env var)."""
    await clear_runtime_key_async(provider)
    return {"status": "ok", "provider": provider}


@router.post("/test-key")
async def test_api_key(req: TestKeyRequest):
    """Test an API key by making a lightweight request to the provider."""
    if req.provider == "anthropic":
        return await _test_anthropic_key(req.api_key)
    elif req.provider == "openrouter":
        return await _test_openrouter_key(req.api_key)
    elif req.provider == "apitcg":
        return await _test_apitcg_key(req.api_key)
    return {"status": "error", "message": f"Unknown provider: {req.provider}"}


@router.get("/provider-models/{provider}")
async def list_provider_models(provider: str, api_key: str | None = None):
    """List available models from a provider using the given or stored API key."""
    key = api_key or get_active_api_key(provider)
    if not key:
        return {"status": "error", "message": "No API key available", "models": []}

    if provider == "claude":
        return await _list_claude_models(key)
    elif provider == "openrouter":
        return await _list_openrouter_models(key)
    return {"status": "error", "message": f"Unknown provider: {provider}", "models": []}


# --- Provider-specific implementations ---


async def _test_anthropic_key(api_key: str) -> dict:
    """Test an Anthropic API key by listing models."""
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        # Use a minimal API call to test the key
        await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
        return {"status": "ok", "message": "API key is valid"}
    except anthropic.AuthenticationError:
        return {"status": "error", "message": "Invalid API key"}
    except Exception as e:
        error_msg = str(e)
        if "credit balance is too low" in error_msg:
            return {"status": "error", "message": "Credit balance too low"}
        return {"status": "error", "message": error_msg}


async def _check_anthropic_balance(api_key: str) -> dict:
    """Check if Anthropic API key has sufficient balance.

    Anthropic doesn't expose a balance endpoint, so we make a minimal
    API call and check for the 'credit_balance_too_low' error.
    """
    if not api_key:
        return {"has_balance": False, "status": "no_key", "message": "No API key configured"}
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
        return {"has_balance": True, "status": "ok", "message": "API key has sufficient balance"}
    except anthropic.AuthenticationError:
        return {"has_balance": False, "status": "invalid_key", "message": "Invalid API key"}
    except Exception as e:
        error_msg = str(e)
        if "credit balance is too low" in error_msg:
            return {"has_balance": False, "status": "no_balance", "message": "Credit balance too low. Please add credits at console.anthropic.com"}
        return {"has_balance": False, "status": "error", "message": error_msg}


async def _test_apitcg_key(api_key: str) -> dict:
    """Test an ApiTCG API key by fetching a single page."""
    try:
        from backend.config import APITCG_BASE_URL
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                APITCG_BASE_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                params={"page": 1},
            )
            if resp.status_code == 401:
                return {"status": "error", "message": "Invalid API key"}
            if resp.status_code == 403:
                return {"status": "error", "message": "Access denied"}
            resp.raise_for_status()
            return {"status": "ok", "message": "API key is valid"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def _test_openrouter_key(api_key: str) -> dict:
    """Test an OpenRouter API key by fetching models."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 401:
                return {"status": "error", "message": "Invalid API key"}
            resp.raise_for_status()
            return {"status": "ok", "message": "API key is valid"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def _list_claude_models(api_key: str) -> dict:
    """List available Claude models from Anthropic API."""
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        models_page = await client.models.list(limit=100)
        models = []
        for m in models_page.data:
            model_id = m.id
            # Filter to usable chat models
            if not any(prefix in model_id for prefix in ("claude-", )):
                continue
            # Determine tier and display name
            display_name = m.display_name if hasattr(m, "display_name") else model_id
            tier = 1 if any(k in model_id for k in ("opus", "sonnet")) else 2
            models.append({"id": model_id, "name": display_name, "tier": tier})

        # Sort: tier 1 first, then by name
        models.sort(key=lambda x: (x["tier"], x["name"]))
        return {"status": "ok", "models": models}
    except anthropic.AuthenticationError:
        return {"status": "error", "message": "Invalid API key", "models": []}
    except Exception as e:
        logger.error(f"Failed to list Claude models: {e}")
        # Fallback to hardcoded list
        return {"status": "ok", "models": AVAILABLE_MODELS["claude"]}


async def _list_openrouter_models(api_key: str) -> dict:
    """List available models from OpenRouter API."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()

        models = []
        # Filter to popular/useful models
        POPULAR_PREFIXES = (
            "openai/gpt-4", "openai/o",
            "anthropic/claude", "google/gemini",
            "meta-llama/llama", "mistralai/",
            "deepseek/", "qwen/",
        )
        for m in data.get("data", []):
            model_id = m.get("id", "")
            if not any(model_id.startswith(p) for p in POPULAR_PREFIXES):
                continue
            display_name = m.get("name", model_id)
            # Detect tier
            tier = 1
            if any(k in model_id for k in ("flash", "mini", "haiku", "llama-3.1-8b")):
                tier = 2
            models.append({"id": model_id, "name": display_name, "tier": tier})

        models.sort(key=lambda x: (x["tier"], x["name"]))
        return {"status": "ok", "models": models}
    except Exception as e:
        logger.error(f"Failed to list OpenRouter models: {e}")
        return {"status": "ok", "models": AVAILABLE_MODELS["openrouter"]}


@router.get("/status")
async def system_status():
    """Get system status: service health + API key presence."""
    neo4j_ok = await verify_connection()
    redis_ok = await verify_redis()

    return {
        "neo4j": neo4j_ok,
        "redis": redis_ok,
        "neo4j_uri": NEO4J_URI,
        "redis_url": REDIS_URL,
        "api_keys": {
            "anthropic": bool(get_active_api_key("claude")),
            "openrouter": bool(get_active_api_key("openrouter")),
            "apitcg": bool(get_active_api_key("apitcg")),
        },
        "runtime_keys": {
            "anthropic": has_runtime_key("anthropic"),
            "openrouter": has_runtime_key("openrouter"),
            "apitcg": has_runtime_key("apitcg"),
        },
    }


@router.get("/balance")
async def check_balance():
    """Check Claude API credit balance by making a minimal API call."""
    api_key = get_active_api_key("claude")
    result = await _check_anthropic_balance(api_key)
    return result
