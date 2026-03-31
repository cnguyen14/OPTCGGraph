"""Agent tool definitions (OpenAI-compatible schema)."""

AGENT_TOOLS = [
    {
        "name": "query_neo4j",
        "description": "Execute a Cypher query against the OPTCG knowledge graph. Use for card data retrieval, synergy lookups, or graph traversal. Returns structured JSON.",
        "parameters": {
            "type": "object",
            "properties": {
                "cypher": {
                    "type": "string",
                    "description": "Valid Cypher query to execute",
                },
                "params": {
                    "type": "object",
                    "description": "Query parameters (optional)",
                },
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
                "card_id": {
                    "type": "string",
                    "description": "Card ID, e.g. 'OP03-070'",
                },
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "find_synergies",
        "description": "Find cards that synergize with a given card. Returns SYNERGY partners (shared family+color). Set include_mechanical=true to also get MECHANICAL_SYNERGY partners (shared keywords+color).",
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {"type": "string"},
                "max_hops": {
                    "type": "integer",
                    "default": 1,
                    "description": "1=direct, 2=2-hop network",
                },
                "color_filter": {
                    "type": "string",
                    "description": "Filter by color (optional)",
                },
                "include_mechanical": {
                    "type": "boolean",
                    "default": False,
                    "description": "Include MECHANICAL_SYNERGY (keyword-based) edges",
                },
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
                "user_color": {
                    "type": "string",
                    "description": "User's deck color for filtering",
                },
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
                "card_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of card IDs",
                },
            },
            "required": ["card_ids"],
        },
    },
    {
        "name": "analyze_leader_playstyles",
        "description": "Analyze tournament data to discover available playstyles for a leader. Call this BEFORE building a deck to show the user their options. Returns playstyle profiles with signature cards and strategy hints.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
            },
            "required": ["leader_id"],
        },
    },
    {
        "name": "build_deck_shell",
        "description": "Build a legal, competitive 50-card deck for a Leader. Enforces all OPTCG rules (50 cards, max 4 copies, color match, no LEADERs in deck). Returns validated deck with cost curve, role coverage, and quality report. ALWAYS use this tool when asked to build a deck.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "budget_max": {
                    "type": "number",
                    "description": "Max total price in USD (optional)",
                },
                "strategy": {
                    "type": "string",
                    "enum": ["aggro", "midrange", "control"],
                },
                "playstyle_hints": {
                    "type": "string",
                    "description": "Comma-separated playstyle preferences from user (e.g. 'rush,low_curve,card_advantage'). Get these from analyze_leader_playstyles results.",
                },
                "signature_cards": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Card IDs that MUST be included (signature cards from playstyle analysis)",
                },
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
                        "highlight_nodes",
                        "show_card_detail",
                        "show_comparison",
                        "animate_synergy_path",
                        "update_deck_list",
                        "show_mana_curve",
                        "focus_subgraph",
                        "clear_highlights",
                    ],
                },
                "payload": {"type": "object", "description": "Action-specific data"},
            },
            "required": ["action", "payload"],
        },
    },
    {
        "name": "validate_deck",
        "description": "Validate a deck against official OPTCG rules and competitive quality standards. Returns PASS/FAIL/WARNING for each check. Use this after building a deck to check for issues.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "card_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of 50 card IDs in the deck",
                },
            },
            "required": ["leader_id", "card_ids"],
        },
    },
    {
        "name": "suggest_deck_fixes",
        "description": "Get smart replacement suggestions for deck validation issues. For each FAIL/WARNING, suggests which card to remove and what to add instead. Use after validate_deck shows problems.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "card_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of card IDs in the deck",
                },
            },
            "required": ["leader_id", "card_ids"],
        },
    },
    {
        "name": "get_meta_overview",
        "description": "Get current tournament meta overview: top archetypes with play rates, most popular leaders. Use when user asks about the meta, what decks are popular, or meta trends.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_leader_meta",
        "description": "Get tournament meta stats for a specific leader: how many decks use it, average placement, top archetypes, most popular cards. Use when user asks how a leader performs competitively.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {
                    "type": "string",
                    "description": "Leader card ID, e.g. 'OP12-061'",
                },
            },
            "required": ["leader_id"],
        },
    },
    {
        "name": "compare_deck_to_meta",
        "description": "Compare user's current deck against tournament-winning decks for the same leader. Shows which popular cards are missing and which unusual cards the user has. Use when user asks 'what am I missing?' or 'how does my deck compare?'.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "deck_card_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Card IDs in user's deck",
                },
            },
            "required": ["leader_id", "deck_card_ids"],
        },
    },
    {
        "name": "recommend_meta_cards",
        "description": "Recommend tournament-proven cards for a leader. Returns cards sorted by top-cut rate and pick rate from real tournament data. Use when user asks 'what cards should I add?' or 'what's hot for this leader?'.",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "limit": {
                    "type": "integer",
                    "default": 10,
                    "description": "Number of cards to return",
                },
            },
            "required": ["leader_id"],
        },
    },
    {
        "name": "get_banned_cards",
        "description": "Get the official Bandai banned card list. Returns all cards currently banned from tournament play. ALWAYS check this before building a deck or recommending cards. Banned cards must NEVER be included in any deck.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "suggest_card_swap",
        "description": "Suggest which card to remove from a full deck (50 cards) when adding a new card. Analyzes tournament pick rates, role coverage, and cost curve impact. Returns a 1-in-1-out recommendation.",
        "parameters": {
            "type": "object",
            "properties": {
                "deck_card_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Current deck card IDs",
                },
                "incoming_card_id": {
                    "type": "string",
                    "description": "Card the user wants to add",
                },
                "leader_id": {
                    "type": "string",
                    "description": "Leader card ID (optional)",
                },
            },
            "required": ["deck_card_ids", "incoming_card_id"],
        },
    },
]
