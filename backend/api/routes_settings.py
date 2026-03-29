"""Settings API endpoints."""

from fastapi import APIRouter

from backend.api.models import ModelSwitchRequest
from backend.config import DEFAULT_PROVIDER, DEFAULT_MODEL

router = APIRouter(prefix="/api/settings", tags=["settings"])

# In-memory settings (per-process, will be per-session later)
_current_settings = {
    "provider": DEFAULT_PROVIDER,
    "model": DEFAULT_MODEL,
}

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
    return {
        "current": _current_settings,
        "available": AVAILABLE_MODELS,
    }


@router.put("/model")
async def switch_model(req: ModelSwitchRequest):
    _current_settings["provider"] = req.provider
    _current_settings["model"] = req.model
    return {"status": "ok", "current": _current_settings}
