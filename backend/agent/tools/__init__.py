"""Tool registry — build and filter tool collections."""

from __future__ import annotations

from backend.agent.tools.analysis_tools import ANALYSIS_TOOLS
from backend.agent.tools.base import (
    AgentTool,
    ToolExecutionContext,
    ToolExecutionError,
    ToolPermissionError,
    execute_tool,
)
from backend.agent.tools.card_tools import CARD_TOOLS
from backend.agent.tools.deck_tools import DECK_TOOLS
from backend.agent.tools.meta_tools import META_TOOLS
from backend.agent.tools.query_tools import QUERY_TOOLS
from backend.agent.tools.simulation_tools import SIMULATION_TOOLS
from backend.agent.tools.ui_tools import UI_TOOLS

__all__ = [
    "AgentTool",
    "ToolExecutionContext",
    "ToolExecutionError",
    "ToolPermissionError",
    "execute_tool",
    "build_tool_registry",
    "filter_tools",
]

_ALL_TOOL_LISTS = [
    CARD_TOOLS,
    DECK_TOOLS,
    META_TOOLS,
    QUERY_TOOLS,
    ANALYSIS_TOOLS,
    SIMULATION_TOOLS,
    UI_TOOLS,
]


def build_tool_registry() -> dict[str, AgentTool]:
    """Return a registry of all available tools keyed by name."""
    registry: dict[str, AgentTool] = {}
    for tool_list in _ALL_TOOL_LISTS:
        for tool in tool_list:
            registry[tool.name] = tool
    return registry


def filter_tools(
    registry: dict[str, AgentTool], allowed: list[str] | tuple[str, ...]
) -> dict[str, AgentTool]:
    """Return a subset of the registry containing only the named tools."""
    return {name: registry[name] for name in allowed if name in registry}
