"""Known OPTCG keyword taxonomy for ability parsing."""

# Timing keywords — when an effect activates
TIMING_KEYWORDS = [
    "On Play",
    "When Attacking",
    "On Block",
    "End of Turn",
    "Activate: Main",
    "On K.O.",
    "On Your Opponent's Attack",
    "Counter",
    "Trigger",
    "Once Per Turn",
]

# Ability keywords — permanent or triggered abilities
ABILITY_KEYWORDS = [
    "Rush",
    "Blocker",
    "Double Attack",
    "Banish",
]

# DON!! mechanics
DON_KEYWORDS = [
    "DON!! x1",
    "DON!! x2",
    "DON!! -1",
    "DON!! -2",
    "DON!! -3",
    "DON!! +1",
    "DON!! +2",
]

# Effect keywords — what the ability does
EFFECT_KEYWORDS = [
    "Bounce",
    "Draw",
    "Trash",
    "KO",
    "Search",
    "Power Buff",
    "Power Debuff",
    "Rest",
    "Play",
    "Return",
    "Add to Hand",
    "Look at Top",
    "Discard",
    "Activate",
]

# All keywords combined for quick lookup
ALL_KEYWORDS = set(TIMING_KEYWORDS + ABILITY_KEYWORDS + DON_KEYWORDS + EFFECT_KEYWORDS)

# Cost tiers for IN_COST_TIER edges
COST_TIERS = [
    {"name": "Free", "range_min": 0, "range_max": 0},
    {"name": "Low", "range_min": 1, "range_max": 2},
    {"name": "Mid", "range_min": 3, "range_max": 4},
    {"name": "High", "range_min": 5, "range_max": 6},
    {"name": "Ultra", "range_min": 7, "range_max": 10},
    {"name": "Mega", "range_min": 11, "range_max": 99},
]


def get_cost_tier(cost: int | None) -> str | None:
    """Get the cost tier name for a given cost value."""
    if cost is None:
        return None
    for tier in COST_TIERS:
        if tier["range_min"] <= cost <= tier["range_max"]:
            return tier["name"]
    return None
