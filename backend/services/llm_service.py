"""Shared LLM completion service — provider-agnostic.

Any module that needs a simple LLM call (no tools, no agent loop) should use
``llm_complete()`` instead of importing the ``anthropic`` SDK directly.  The
function automatically picks the active provider and falls back to the other
one when the primary key is missing.
"""

from __future__ import annotations

import logging
import re

import anthropic
import httpx

from backend.services.settings_service import (
    get_active_api_key,
    get_current_model_config,
)

logger = logging.getLogger(__name__)

# ---- Model preferences per provider ----------------------------------------

MODEL_PREFERENCE: dict[str, dict[str, str]] = {
    "anthropic": {
        "fast": "claude-haiku-4-5-20251001",
        "smart": "claude-sonnet-4-20250514",
    },
    "openrouter": {
        "fast": "google/gemini-2.0-flash-001",
        "smart": "openai/gpt-4o",
    },
}

_PROVIDER_FALLBACK_ORDER = ("anthropic", "openrouter")


# ---- Exceptions -------------------------------------------------------------


class LLMNotAvailableError(Exception):
    """Raised when no LLM provider has a valid API key configured."""


# ---- Public helpers ---------------------------------------------------------


def has_any_llm_key() -> bool:
    """Return True if at least one LLM provider has an API key."""
    return bool(get_active_api_key("anthropic") or get_active_api_key("openrouter"))


def get_default_model(prefer: str = "smart") -> str:
    """Return the model ID for the currently active provider.

    ``prefer`` is ``"smart"`` (best quality) or ``"fast"`` (lowest latency).
    """
    config = get_current_model_config()
    provider = _normalise_provider(config.get("provider", "anthropic"))
    prefs = MODEL_PREFERENCE.get(provider, MODEL_PREFERENCE["anthropic"])
    return prefs.get(prefer, prefs["smart"])


def strip_json_fences(text: str) -> str:
    """Strip markdown code fences (```json … ```) from LLM output."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


# ---- Core completion --------------------------------------------------------


async def llm_complete(
    system: str,
    message: str,
    *,
    prefer: str = "smart",
    max_tokens: int = 4096,
    timeout: float = 90.0,
) -> str:
    """Send a single-turn LLM completion and return the text response.

    Parameters
    ----------
    system:
        System prompt.
    message:
        User message.
    prefer:
        ``"smart"`` for best-quality model, ``"fast"`` for cheapest/fastest.
    max_tokens:
        Maximum tokens in the response.
    timeout:
        Request timeout in seconds.

    Returns
    -------
    str
        The text content of the LLM response.

    Raises
    ------
    LLMNotAvailableError
        If no provider has a valid API key.
    """
    # Determine provider + model, with automatic fallback
    provider, api_key, model = _resolve_provider(prefer)

    if provider == "anthropic":
        return await _call_anthropic(
            api_key, model, system, message, max_tokens, timeout
        )
    else:
        return await _call_openrouter(
            api_key, model, system, message, max_tokens, timeout
        )


# ---- Internal ---------------------------------------------------------------


def _normalise_provider(name: str) -> str:
    """Map legacy ``"claude"`` to canonical ``"anthropic"``."""
    return "anthropic" if name in ("claude", "anthropic") else name


def _resolve_provider(prefer: str) -> tuple[str, str, str]:
    """Pick a provider that has an API key, with fallback.

    Returns (provider, api_key, model).
    """
    config = get_current_model_config()
    primary = _normalise_provider(config.get("provider", "anthropic"))

    # Try primary provider first
    for candidate in [primary] + [p for p in _PROVIDER_FALLBACK_ORDER if p != primary]:
        key = get_active_api_key(candidate)
        if key:
            prefs = MODEL_PREFERENCE.get(candidate, MODEL_PREFERENCE["anthropic"])
            model = prefs.get(prefer, prefs["smart"])
            return candidate, key, model

    raise LLMNotAvailableError("No LLM API key configured. Set one in Settings > BYOK.")


async def _call_anthropic(
    api_key: str,
    model: str,
    system: str,
    message: str,
    max_tokens: int,
    timeout: float,
) -> str:
    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout)
    resp = await client.messages.create(
        model=model,
        system=system or "",
        messages=[{"role": "user", "content": message}],
        max_tokens=max_tokens,
    )
    return resp.content[0].text if resp.content else ""


async def _call_openrouter(
    api_key: str,
    model: str,
    system: str,
    message: str,
    max_tokens: int,
    timeout: float,
) -> str:
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": message})

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        data = resp.json()

    choice = data.get("choices", [{}])[0]
    return choice.get("message", {}).get("content", "")
