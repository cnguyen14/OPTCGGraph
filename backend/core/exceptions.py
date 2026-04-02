"""Custom exception hierarchy for consistent error handling."""

from __future__ import annotations


class OPTCGError(Exception):
    """Base exception for the OPTCG application."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class CardNotFoundError(OPTCGError):
    """Raised when a card ID does not exist in the knowledge graph."""

    def __init__(self, card_id: str):
        super().__init__(f"Card '{card_id}' not found", 404)


class DeckValidationError(OPTCGError):
    """Raised when a deck fails validation rules."""

    def __init__(self, message: str):
        super().__init__(message, 422)


class LLMProviderError(OPTCGError):
    """Raised when an LLM provider call fails."""

    def __init__(self, message: str):
        super().__init__(message, 502)


class StorageError(OPTCGError):
    """Raised when a storage operation (Redis, file) fails."""

    def __init__(self, message: str):
        super().__init__(message, 500)


class ResourceNotFoundError(OPTCGError):
    """Raised when a requested resource does not exist."""

    def __init__(self, resource: str, resource_id: str):
        super().__init__(f"{resource} '{resource_id}' not found", 404)
