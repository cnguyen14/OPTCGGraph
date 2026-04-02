"""Analysis tools — playstyle analysis."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_analyze_leader_playstyles(args: dict, ctx: ToolExecutionContext) -> str:
    from backend.ai.playstyle_analyzer import analyze_leader_playstyles

    profiles = await analyze_leader_playstyles(ctx.driver, args["leader_id"])
    return json.dumps({
        "leader_id": args["leader_id"],
        "playstyles": [p.to_dict() for p in profiles],
        "instruction": "Present these playstyles to the user and ask which they prefer before building.",
    }, default=str)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

ANALYZE_LEADER_PLAYSTYLES = AgentTool(
    name="analyze_leader_playstyles",
    description="Analyze tournament data to discover available playstyles for a leader. Call this BEFORE building a deck to show the user their options. Returns playstyle profiles with signature cards and strategy hints.",
    parameters={
        "type": "object",
        "properties": {
            "leader_id": {"type": "string", "description": "Leader card ID"},
        },
        "required": ["leader_id"],
    },
    handler=_handle_analyze_leader_playstyles,
    category="analysis",
)

ANALYSIS_TOOLS: list[AgentTool] = [ANALYZE_LEADER_PLAYSTYLES]
