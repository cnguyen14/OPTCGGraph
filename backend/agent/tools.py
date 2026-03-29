"""Agent tool definitions (OpenAI-compatible schema)."""

AGENT_TOOLS = [
    {
        "name": "query_neo4j",
        "description": "Execute a Cypher query against the OPTCG knowledge graph. Use for card data retrieval, synergy lookups, or graph traversal. Returns structured JSON.",
        "parameters": {
            "type": "object",
            "properties": {
                "cypher": {"type": "string", "description": "Valid Cypher query to execute"},
                "params": {"type": "object", "description": "Query parameters (optional)"},
            },
            "required": ["cypher"],
        },
    },
    {
        "name": "get_card",
        "description": "Get full details for a specific card by ID. Returns all properties including ability, keywords, pricing, images.",
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {"type": "string", "description": "Card ID, e.g. 'OP03-070'"},
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "find_synergies",
        "description": "Find all cards that synergize with a given card via shared families or keywords.",
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {"type": "string"},
                "max_hops": {"type": "integer", "default": 1, "description": "1=direct, 2=2-hop network"},
                "color_filter": {"type": "string", "description": "Filter by color (optional)"},
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "find_counters",
        "description": "Find cards that counter a specific card or strategy.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_card_id": {"type": "string", "description": "Card to counter"},
                "user_color": {"type": "string", "description": "User's deck color for filtering"},
            },
            "required": ["target_card_id"],
        },
    },
    {
        "name": "get_mana_curve",
        "description": "Get cost distribution for a set of cards.",
        "parameters": {
            "type": "object",
            "properties": {
                "card_ids": {"type": "array", "items": {"type": "string"}, "description": "List of card IDs"},
            },
            "required": ["card_ids"],
        },
    },
    {
        "name": "build_deck_shell",
        "description": "Generate an initial 50-card deck skeleton for a Leader. Returns cards organized by role.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "budget_max": {"type": "number", "description": "Max total price in USD (optional)"},
                "strategy": {"type": "string", "enum": ["aggro", "midrange", "control"]},
            },
            "required": ["leader_id"],
        },
    },
    {
        "name": "update_ui_state",
        "description": "Send UI commands to frontend (highlight nodes, show card detail, update deck list, etc.).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "highlight_nodes", "show_card_detail", "show_comparison",
                        "animate_synergy_path", "update_deck_list", "show_mana_curve",
                        "focus_subgraph", "clear_highlights",
                    ],
                },
                "payload": {"type": "object", "description": "Action-specific data"},
            },
            "required": ["action", "payload"],
        },
    },
]
