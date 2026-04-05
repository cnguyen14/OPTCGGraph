"""UI tools — send commands to the frontend."""

from __future__ import annotations

import json

from backend.agent.tools.base import AgentTool, ToolExecutionContext

# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


async def _handle_update_ui_state(args: dict, ctx: ToolExecutionContext) -> str:
    return json.dumps({
        "action": args.get("action"),
        "payload": args.get("payload"),
        "status": "emitted",
    })


# ---------------------------------------------------------------------------
# Tool definition
# ---------------------------------------------------------------------------

UPDATE_UI_STATE = AgentTool(
    name="update_ui_state",
    description="Send UI commands to frontend. Actions: add_card_to_deck (payload: {card_ids: [...]}), remove_card_from_deck (payload: {card_ids: [...], remove_all: bool}), update_deck_list (payload: {leader_id, cards}), show_card_detail (payload: {card_id}), show_card_list (payload: {card_ids, title}), etc.",
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "highlight_nodes",
                    "show_card_detail",
                    "show_card_list",
                    "show_comparison",
                    "animate_synergy_path",
                    "add_card_to_deck",
                    "remove_card_from_deck",
                    "update_deck_list",
                    "show_swap_suggestions",
                    "show_mana_curve",
                    "focus_subgraph",
                    "clear_highlights",
                ],
            },
            "payload": {"type": "object", "description": "Action-specific data"},
        },
        "required": ["action", "payload"],
    },
    handler=_handle_update_ui_state,
    category="ui",
)

UI_TOOLS: list[AgentTool] = [UPDATE_UI_STATE]
