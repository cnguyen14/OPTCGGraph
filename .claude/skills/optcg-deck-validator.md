---
name: optcg-deck-validator
description: Validate an OPTCG deck against official rules and competitive quality standards
---

# OPTCG Deck Validator

You are validating an OPTCG (One Piece TCG) deck. Use the backend API and your knowledge of OPTCG rules to produce a comprehensive validation report.

## How to Validate

### Step 1: Get the deck to validate
The user will provide either:
- A leader ID + list of card IDs
- A leader ID (use the AI agent's `build_deck_shell` to generate a deck first)
- A decklist from the conversation context

### Step 2: Call the validation API
```bash
curl -s -X POST http://localhost:8000/api/deck/validate \
  -H "Content-Type: application/json" \
  -d '{"leader_id": "OP01-001", "card_ids": ["OP01-004", "OP01-004", "OP01-004", "OP01-004", ...]}'
```

### Step 3: Interpret the results
The API returns checks with status PASS/FAIL/WARNING. Present them clearly.

## OPTCG Official Deck Building Rules

These are HARD RULES — a deck that fails any of these is **illegal**:

1. **Exactly 50 cards** in the main deck (Leader and 10 DON!! cards are separate)
2. **Maximum 4 copies** of any card with the same card number
3. **All cards must match Leader's color(s):**
   - Mono-color Leader (5 Life): all 50 cards must be that color
   - Dual-color Leader (4 Life): each card must match at least one of the two colors
4. **No LEADER cards** in the 50-card main deck
5. **No banned cards** (check https://en.onepiece-cardgame.com/topics/029.php)

## OPTCG Competitive Quality Standards

These are based on tournament-winning decklists (77% character, 20% event, 3% stage):

### Cost Curve (from pro tournament data)
| Cost Range | Target Count | Role |
|-----------|-------------|------|
| 0-2 | 8-12 cards | Early game setup, cheap blockers, counter cards |
| 3-5 | 15-20 cards | Mid-game threats, main board presence |
| 6-9 | 8-12 cards | Late-game finishers, high-impact plays |
| 10+ | 0-2 cards | Game-ending bombs (optional) |

### Card Type Ratio
| Type | Target | Range |
|------|--------|-------|
| CHARACTER | ~77% (38-42 cards) | 60-90% |
| EVENT | ~20% (8-10 cards) | 8-30% |
| STAGE | ~3% (0-4 cards) | 0-10% |

### Role Coverage
- **Blockers**: 4-6 cards with Blocker keyword (defense against Rush/attacks)
- **Draw/Search**: 4+ cards (card advantage = winning)
- **Removal**: 4+ cards with KO/Bounce/Trash (board control)
- **Finishers**: Cost 7+, Power 7000+ (win condition)
- **Counter density**: Average ~800+ counter value per card

### Consistency
- At least **6 unique cards at 4x** copies (you want to draw your best cards every game)
- Core engine cards MUST be at 4x
- Tech/meta cards can be 1-2x

## Archetype Expectations

### Aggro
- Higher count of low-cost characters (12+ at cost 0-3)
- Rush keyword is essential
- Lower event count
- Fast clock: aim to win by turn 5-6

### Midrange
- Balanced curve
- Mix of proactive threats and reactive answers
- Strong turn 3-5 plays
- Win by turns 6-8

### Control
- Higher event count (10-14)
- More removal effects
- Fewer low-cost characters
- Win by turns 8+
- Need strong card draw to find answers

## Output Format

Present the validation report as:

```
## Deck Validation Report: [Leader Name] ([Leader ID])

### Legal Status: [LEGAL / ILLEGAL]
[If illegal, list all FAIL checks]

### Rule Checks
- DECK_SIZE: [PASS/FAIL] — [message]
- COPY_LIMIT: [PASS/FAIL] — [message]
- COLOR_MATCH: [PASS/FAIL] — [message]
- LEADER_VALID: [PASS/FAIL] — [message]
- NO_LEADER_IN_DECK: [PASS/FAIL] — [message]

### Quality Checks
- COST_CURVE: [PASS/WARNING] — [details]
- COUNTER_DENSITY: [PASS/WARNING] — [details]
- TYPE_RATIO: [PASS/WARNING] — [details]
- FOUR_COPY_CORE: [PASS/WARNING] — [details]
- WIN_CONDITION: [PASS/WARNING] — [details]
- BLOCKER_COUNT: [PASS/WARNING] — [details]
- DRAW_ENGINE: [PASS/WARNING] — [details]
- REMOVAL_OPTIONS: [PASS/WARNING] — [details]

### Recommendations
[Specific, actionable suggestions to fix any FAIL or WARNING]
```
