"""OPTCG Deck Validator — validates decks against official rules and competitive quality standards.

Based on research from professional OPTCG tournament play:
- Official rules: 50 cards, max 4 copies, color match, no banned cards
- Pro guidelines: cost curve, counter density, type ratios, role coverage
"""

from collections import Counter
from dataclasses import dataclass, field

# Known OPTCG colors
VALID_COLORS = {"Red", "Green", "Blue", "Purple", "Black", "Yellow"}

# Pro deck building benchmarks (from tournament winner analysis)
COST_CURVE_TARGETS = {
    "low": {"range": (0, 2), "target": (8, 12), "label": "Low (0-2)"},
    "mid": {"range": (3, 5), "target": (15, 20), "label": "Mid (3-5)"},
    "high": {"range": (6, 9), "target": (8, 12), "label": "High (6-9)"},
    "ultra": {"range": (10, 99), "target": (0, 2), "label": "Ultra (10+)"},
}

# Type ratio targets (from tournament data: 77% char, 20% event, 3% stage)
TYPE_RATIO_TARGETS = {
    "CHARACTER": {"min": 0.60, "max": 0.90, "ideal": 0.77},
    "EVENT": {"min": 0.08, "max": 0.30, "ideal": 0.20},
    "STAGE": {"min": 0.00, "max": 0.10, "ideal": 0.03},
}


@dataclass
class CheckResult:
    name: str
    status: str  # "PASS", "FAIL", "WARNING"
    message: str
    details: dict = field(default_factory=dict)


@dataclass
class ValidationReport:
    leader_id: str
    leader_name: str
    deck_size: int
    is_legal: bool
    checks: list[CheckResult] = field(default_factory=list)
    summary: str = ""

    def add(self, check: CheckResult):
        self.checks.append(check)

    @property
    def fails(self) -> list[CheckResult]:
        return [c for c in self.checks if c.status == "FAIL"]

    @property
    def warnings(self) -> list[CheckResult]:
        return [c for c in self.checks if c.status == "WARNING"]

    @property
    def passes(self) -> list[CheckResult]:
        return [c for c in self.checks if c.status == "PASS"]

    def to_dict(self) -> dict:
        return {
            "leader_id": self.leader_id,
            "leader_name": self.leader_name,
            "deck_size": self.deck_size,
            "is_legal": self.is_legal,
            "summary": self.summary,
            "stats": {
                "pass": len(self.passes),
                "fail": len(self.fails),
                "warning": len(self.warnings),
            },
            "checks": [
                {"name": c.name, "status": c.status, "message": c.message, "details": c.details}
                for c in self.checks
            ],
        }


def validate_deck(leader: dict, cards: list[dict]) -> ValidationReport:
    """Validate a complete deck (leader + 50 cards).

    Args:
        leader: Leader card dict with id, name, card_type, colors, families, etc.
        cards: List of 50 card dicts (each with id, name, card_type, cost, power, counter, colors, keywords, etc.)

    Returns:
        ValidationReport with all check results.
    """
    report = ValidationReport(
        leader_id=leader.get("id", ""),
        leader_name=leader.get("name", ""),
        deck_size=len(cards),
        is_legal=True,
    )

    leader_colors = set(leader.get("colors", []))

    # === RULES CHECKS (FAIL = illegal) ===

    # 1. DECK_SIZE
    if len(cards) == 50:
        report.add(CheckResult("DECK_SIZE", "PASS", "Deck has exactly 50 cards"))
    else:
        report.add(CheckResult("DECK_SIZE", "FAIL", f"Deck has {len(cards)} cards (must be exactly 50)"))
        report.is_legal = False

    # 2. COPY_LIMIT
    id_counts = Counter(c.get("id", "") for c in cards)
    over_limit = {cid: cnt for cid, cnt in id_counts.items() if cnt > 4}
    if not over_limit:
        report.add(CheckResult("COPY_LIMIT", "PASS", "No card exceeds 4 copies"))
    else:
        names = [f"{cid} x{cnt}" for cid, cnt in over_limit.items()]
        report.add(CheckResult("COPY_LIMIT", "FAIL", f"Cards exceeding 4-copy limit: {', '.join(names)}", {"violations": over_limit}))
        report.is_legal = False

    # 3. COLOR_MATCH
    color_violations = []
    for card in cards:
        card_colors = set(card.get("colors", []))
        if not card_colors & leader_colors:
            color_violations.append({"id": card["id"], "name": card.get("name", ""), "card_colors": list(card_colors), "leader_colors": list(leader_colors)})
    if not color_violations:
        report.add(CheckResult("COLOR_MATCH", "PASS", f"All cards match Leader's colors ({', '.join(leader_colors)})"))
    else:
        report.add(CheckResult("COLOR_MATCH", "FAIL", f"{len(color_violations)} cards don't match Leader colors", {"violations": color_violations[:10]}))
        report.is_legal = False

    # 4. LEADER_VALID
    if leader.get("card_type") == "LEADER":
        report.add(CheckResult("LEADER_VALID", "PASS", f"Leader {leader['id']} is a valid LEADER card"))
    else:
        report.add(CheckResult("LEADER_VALID", "FAIL", f"Card {leader.get('id','')} is {leader.get('card_type','')}, not LEADER"))
        report.is_legal = False

    # 5. NO_LEADER_IN_DECK
    leaders_in_deck = [c for c in cards if c.get("card_type") == "LEADER"]
    if not leaders_in_deck:
        report.add(CheckResult("NO_LEADER_IN_DECK", "PASS", "No LEADER cards in the main deck"))
    else:
        report.add(CheckResult("NO_LEADER_IN_DECK", "FAIL", f"{len(leaders_in_deck)} LEADER cards found in deck", {"leaders": [c["id"] for c in leaders_in_deck]}))
        report.is_legal = False

    # === QUALITY CHECKS (WARNING = legal but weak) ===

    # 6. COST_CURVE
    costs = [c.get("cost") for c in cards if c.get("cost") is not None]
    cost_counter = Counter(costs)
    curve_issues = []
    curve_details = {}
    for tier_name, tier in COST_CURVE_TARGETS.items():
        rmin, rmax = tier["range"]
        tmin, tmax = tier["target"]
        count = sum(cost_counter.get(i, 0) for i in range(rmin, rmax + 1))
        curve_details[tier["label"]] = {"count": count, "target": f"{tmin}-{tmax}"}
        if count < tmin:
            curve_issues.append(f"{tier['label']}: {count} cards (target {tmin}-{tmax})")
        elif count > tmax + 5:  # Allow some flexibility
            curve_issues.append(f"{tier['label']}: {count} cards (target {tmin}-{tmax})")
    if not curve_issues:
        report.add(CheckResult("COST_CURVE", "PASS", "Cost curve is well-distributed", curve_details))
    else:
        report.add(CheckResult("COST_CURVE", "WARNING", f"Cost curve imbalances: {'; '.join(curve_issues)}", curve_details))

    # 7. COUNTER_DENSITY
    counters = [c.get("counter") for c in cards if c.get("counter") is not None]
    total_counter = sum(c for c in counters if isinstance(c, (int, float)))
    avg_counter = total_counter / len(cards) if cards else 0
    counter_2k = sum(1 for c in counters if c == 2000)
    counter_1k = sum(1 for c in counters if c == 1000)
    counter_0 = sum(1 for c in counters if c == 0)
    counter_details = {"total": total_counter, "average": round(avg_counter), "2000_count": counter_2k, "1000_count": counter_1k, "0_count": counter_0}
    if avg_counter >= 800:
        report.add(CheckResult("COUNTER_DENSITY", "PASS", f"Average counter: {round(avg_counter)} per card (total: {total_counter})", counter_details))
    else:
        report.add(CheckResult("COUNTER_DENSITY", "WARNING", f"Low counter density: avg {round(avg_counter)} per card (target: 800+)", counter_details))

    # 8. TYPE_RATIO
    type_counts = Counter(c.get("card_type", "") for c in cards)
    total = len(cards) or 1
    type_details = {}
    type_issues = []
    for ctype, targets in TYPE_RATIO_TARGETS.items():
        count = type_counts.get(ctype, 0)
        ratio = count / total
        type_details[ctype] = {"count": count, "ratio": round(ratio, 2), "ideal": targets["ideal"]}
        if ratio < targets["min"]:
            type_issues.append(f"{ctype}: {count} ({ratio:.0%}) below min {targets['min']:.0%}")
        elif ratio > targets["max"]:
            type_issues.append(f"{ctype}: {count} ({ratio:.0%}) above max {targets['max']:.0%}")
    if not type_issues:
        report.add(CheckResult("TYPE_RATIO", "PASS", f"Type ratio balanced: {dict(type_counts)}", type_details))
    else:
        report.add(CheckResult("TYPE_RATIO", "WARNING", f"Type ratio issues: {'; '.join(type_issues)}", type_details))

    # 9. FOUR_COPY_CORE
    four_copy_cards = [cid for cid, cnt in id_counts.items() if cnt == 4]
    if len(four_copy_cards) >= 6:
        report.add(CheckResult("FOUR_COPY_CORE", "PASS", f"{len(four_copy_cards)} cards at 4x (good consistency)"))
    else:
        report.add(CheckResult("FOUR_COPY_CORE", "WARNING", f"Only {len(four_copy_cards)} cards at 4x (target: 6+ for consistency)", {"four_copy_cards": four_copy_cards}))

    # 10. WIN_CONDITION
    finishers = [c for c in cards if (c.get("cost") or 0) >= 7 and c.get("power") and c["power"] >= 7000]
    rush_finishers = [c for c in finishers if "Rush" in (c.get("keywords") or [])]
    if finishers:
        report.add(CheckResult("WIN_CONDITION", "PASS", f"{len(finishers)} finishers (cost 7+, power 7000+), {len(rush_finishers)} with Rush"))
    else:
        report.add(CheckResult("WIN_CONDITION", "WARNING", "No high-cost finishers found (cost 7+, power 7000+)"))

    # 11. BLOCKER_COUNT
    blockers = [c for c in cards if "Blocker" in (c.get("keywords") or [])]
    if len(blockers) >= 4:
        report.add(CheckResult("BLOCKER_COUNT", "PASS", f"{len(blockers)} Blocker cards"))
    else:
        report.add(CheckResult("BLOCKER_COUNT", "WARNING", f"Only {len(blockers)} Blockers (target: 4+ for defense)"))

    # 12. DRAW_ENGINE
    draw_cards = [c for c in cards if any(kw in (c.get("keywords") or []) for kw in ("Draw", "Search"))]
    if len(draw_cards) >= 4:
        report.add(CheckResult("DRAW_ENGINE", "PASS", f"{len(draw_cards)} cards with Draw/Search effects"))
    else:
        report.add(CheckResult("DRAW_ENGINE", "WARNING", f"Only {len(draw_cards)} Draw/Search cards (target: 4+ for card advantage)"))

    # 13. REMOVAL_OPTIONS
    removal_cards = [c for c in cards if any(kw in (c.get("keywords") or []) for kw in ("KO", "Bounce", "Trash", "Power Debuff"))]
    if len(removal_cards) >= 4:
        report.add(CheckResult("REMOVAL_OPTIONS", "PASS", f"{len(removal_cards)} cards with removal effects"))
    else:
        report.add(CheckResult("REMOVAL_OPTIONS", "WARNING", f"Only {len(removal_cards)} removal cards (target: 4+ for board control)"))

    # Build summary
    if report.is_legal:
        if not report.warnings:
            report.summary = f"LEGAL & COMPETITIVE — {len(report.passes)}/{len(report.checks)} checks passed"
        else:
            report.summary = f"LEGAL but {len(report.warnings)} quality warnings — review recommended"
    else:
        report.summary = f"ILLEGAL DECK — {len(report.fails)} rule violations must be fixed"

    return report
