Validate an OPTCG deck against official rules and competitive quality standards.

Usage: /validate-deck <leader_id> [card_ids...]
Or: /validate-deck <leader_id> (will auto-generate deck first using build_deck_shell)

## Steps

1. If only leader_id provided, first call `GET /api/graph/leader/{leader_id}/deck-candidates?limit=50` to get candidate cards
2. Call `POST /api/deck/validate` with the leader_id and card_ids
3. Present the validation report with PASS/FAIL/WARNING for each check

## OPTCG Official Rules (FAIL = illegal deck)
- Exactly 50 cards in main deck
- Max 4 copies of any card
- All cards must match Leader's color(s)
- No LEADER cards in the 50-card deck

## Quality Checks (WARNING = legal but weak)
- Cost curve: 0-2 cost (8-12), 3-5 cost (15-20), 6-9 cost (8-12), 10+ (0-2)
- Counter density: average 800+ per card
- Type ratio: ~77% characters, ~20% events, ~3% stages
- At least 6 cards at 4x copies (consistency)
- Win condition: finishers with cost 7+, power 7000+
- Blockers: 4+ cards
- Draw/Search: 4+ cards
- Removal: 4+ cards (KO, Bounce, Trash)

## Output
Present as a clear report with icons: ✓ PASS, ✗ FAIL, ⚠ WARNING
Include specific fix recommendations for any failures.
