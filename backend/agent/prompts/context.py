"""Dynamic context sections injected per-request."""

from __future__ import annotations

from collections import Counter

from backend.agent.types import DeckContext


def get_banned_cards_section(banned_cards: list[dict]) -> str:
    """Render the banned cards list for the system prompt."""
    if not banned_cards:
        return ""
    lines = [f"- **{c.get('name', c['id'])}** ({c['id']})" for c in banned_cards]
    return (
        f"\n## Currently Banned Cards ({len(banned_cards)} cards)\n"
        "The following cards are banned from official tournament play:\n"
        + "\n".join(lines)
        + "\nDo NOT include any of these in decks or recommendations."
    )


def get_deck_context_section(deck: DeckContext) -> str:
    """Render the user's current deck state."""
    if not deck.card_ids:
        return (
            "\n## User's Current Deck\n"
            "No deck currently built. The user has not added any cards yet."
        )
    card_counts = Counter(deck.card_ids)
    deck_summary = ", ".join(
        f"{cnt}x {cid}" for cid, cnt in card_counts.most_common()
    )
    return (
        f"\n## User's Current Deck ({len(deck.card_ids)}/50 cards)\n"
        f"Leader: {deck.leader_id or 'Not set'}\n"
        f"Cards: {deck_summary}\n"
        "\nYou can see the user's current deck above. When they ask to validate, "
        "use the validate_deck tool with this leader and these card IDs. "
        "When they ask about their deck, reference these actual cards."
    )


def get_leader_context_section(leader_id: str | None) -> str:
    """Render the selected leader context."""
    if not leader_id:
        return ""
    return f"\n## Current Context\nSelected Leader: {leader_id}"
