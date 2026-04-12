"""Template-based effect resolution for the OPTCG simulator.

Resolves EffectTemplate objects attached to cards. Each template specifies
its type, trigger, target selection, conditions, and parameters. This replaces
the old keyword-matching approach with parameterized effect resolution.

Backward compatible: cards without effect templates fall back to keyword-based
resolution via the legacy methods.
"""

from __future__ import annotations

import logging
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .engine import GameEngine

from .models import (
    CardState,
    EffectCondition,
    EffectTemplate,
    EffectTrigger,
    EffectType,
    GameCard,
    PlayerState,
)

logger = logging.getLogger(__name__)


class EffectHandler:
    """Resolves effect templates during gameplay."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()

    # --- Public trigger entry points ---

    def resolve_on_play(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve effects when a card enters the field."""
        templates = card.get_effects_by_trigger(EffectTrigger.ON_PLAY)
        if templates:
            for tmpl in templates:
                self._resolve_template(engine, tmpl, card, player, opponent)
        else:
            # Legacy fallback for cards without parsed templates
            self._legacy_on_play(engine, card, player, opponent)

    def resolve_when_attacking(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve 'When Attacking' effects."""
        templates = card.get_effects_by_trigger(EffectTrigger.ON_ATTACK)
        if templates:
            for tmpl in templates:
                self._resolve_template(engine, tmpl, card, player, opponent)
        else:
            self._legacy_when_attacking(engine, card, player, opponent)

    def resolve_on_ko(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve 'On K.O.' effects."""
        templates = card.get_effects_by_trigger(EffectTrigger.ON_KO)
        if templates:
            for tmpl in templates:
                self._resolve_template(engine, tmpl, card, player, opponent)
        else:
            self._legacy_on_ko(engine, card, player, opponent)

    def resolve_trigger(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve trigger effects when a life card is revealed."""
        templates = card.get_effects_by_trigger(EffectTrigger.TRIGGER)
        if templates:
            for tmpl in templates:
                self._resolve_template(engine, tmpl, card, player, opponent)
        else:
            self._legacy_trigger(engine, card, player, opponent)

    def resolve_on_block(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve 'When Blocking' effects."""
        templates = card.get_effects_by_trigger(EffectTrigger.ON_BLOCK)
        for tmpl in templates:
            self._resolve_template(engine, tmpl, card, player, opponent)

    def resolve_passive(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Resolve passive effects (Stage cards, activated each turn).

        Only processes effects that produce per-turn value (draw, power boost).
        Static passives like Blocker/Rush are handled by has_keyword checks.
        """
        templates = card.get_effects_by_trigger(EffectTrigger.PASSIVE)
        for tmpl in templates:
            # Skip static keyword effects — they don't need resolution
            if tmpl.type in (
                EffectType.BLOCKER,
                EffectType.RUSH,
                EffectType.DOUBLE_ATTACK,
                EffectType.BANISH,
            ):
                continue
            self._resolve_template(engine, tmpl, card, player, opponent)

    # --- Keyword queries (used by engine and agents) ---

    def has_keyword(self, card: GameCard, keyword: str) -> bool:
        """Check for keyword via effect templates first, then raw keywords."""
        type_map = {
            "blocker": EffectType.BLOCKER,
            "rush": EffectType.RUSH,
            "double attack": EffectType.DOUBLE_ATTACK,
            "banish": EffectType.BANISH,
        }
        if keyword.lower() in type_map:
            if card.has_effect_type(type_map[keyword.lower()]):
                return True
        return keyword.lower() in [k.lower() for k in card.keywords]

    def has_rush(self, card: GameCard) -> bool:
        return self.has_keyword(card, "rush")

    def has_blocker(self, card: GameCard) -> bool:
        return self.has_keyword(card, "blocker")

    def has_double_attack(self, card: GameCard) -> bool:
        return self.has_keyword(card, "double attack")

    def has_banish(self, card: GameCard) -> bool:
        return self.has_keyword(card, "banish")

    # --- Template resolution dispatcher ---

    def _resolve_template(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Dispatch a single effect template to its handler."""
        if not tmpl.can_use():
            return
        tmpl.mark_used()

        handlers = {
            EffectType.KO: self._resolve_ko,
            EffectType.BOUNCE: self._resolve_bounce,
            EffectType.DRAW: self._resolve_draw,
            EffectType.SEARCH: self._resolve_search,
            EffectType.TRASH_FROM_HAND: self._resolve_trash,
            EffectType.REST: self._resolve_rest,
            EffectType.POWER_BOOST: self._resolve_power_boost,
            EffectType.POWER_REDUCE: self._resolve_power_reduce,
            EffectType.PLAY_FROM_TRASH: self._resolve_play_from_trash,
            EffectType.DON_MINUS: self._resolve_don_minus,
            EffectType.BOTTOM_DECK: self._resolve_bottom_deck,
            EffectType.TRIGGER_PLAY: self._resolve_trigger_play,
        }

        handler = handlers.get(tmpl.type)
        if handler:
            logger.debug(
                "Effect fired: %s [%s] from %s (player %s)",
                tmpl.type.value,
                tmpl.trigger.value,
                source.name,
                player.player_id,
            )
            engine.track_effect_fired(player.player_id, source.card_id)
            handler(engine, tmpl, source, player, opponent)

    # --- Individual effect resolvers ---

    def _resolve_ko(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """KO opponent characters matching conditions."""
        targets = self._select_targets(tmpl, source, player, opponent)
        for target in targets[: tmpl.count]:
            if target not in opponent.field:
                continue
            opponent.field.remove(target)
            opponent.don_field += target.attached_don
            target.attached_don = 0
            target.power_modifier = 0
            opponent.trash.append(target)
            engine.state.log(opponent.player_id, "effect", "ko", card_name=target.name)

    def _resolve_bounce(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Return opponent characters to hand."""
        targets = self._select_targets(tmpl, source, player, opponent)
        for target in targets[: tmpl.count]:
            if target not in opponent.field:
                continue
            opponent.field.remove(target)
            target.state = CardState.ACTIVE
            opponent.don_field += target.attached_don
            target.attached_don = 0
            target.power_modifier = 0
            opponent.hand.append(target)
            engine.state.log(opponent.player_id, "effect", "bounced", card_name=target.name)

    def _resolve_draw(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Draw cards."""
        amount = tmpl.amount if tmpl.amount > 0 else 1
        for _ in range(amount):
            if player.deck:
                card = player.deck.pop(0)
                player.hand.append(card)
                engine.state.log(player.player_id, "effect", "draw", card_name=card.name)

    def _resolve_search(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Look at top N cards, add best matching one to hand."""
        if not player.deck:
            return
        look_count = tmpl.amount if tmpl.amount > 0 else 5
        top = player.deck[:look_count]
        if not top:
            return

        # Filter by condition if present
        if tmpl.condition:
            matching = [c for c in top if self._matches_condition(c, tmpl.condition, source)]
            if matching:
                best = max(matching, key=lambda c: c.cost)
            else:
                best = max(top, key=lambda c: c.cost)
        else:
            best = max(top, key=lambda c: c.cost)

        if best not in player.deck:
            return
        player.deck.remove(best)
        player.hand.append(best)
        self.rng.shuffle(player.deck[: look_count - 1])
        engine.state.log(player.player_id, "effect", "search", card_name=best.name)

    def _resolve_trash(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Opponent discards from hand."""
        count = tmpl.count if tmpl.count > 0 else 1
        for _ in range(count):
            if not opponent.hand:
                break
            card = self.rng.choice(opponent.hand)
            opponent.hand.remove(card)
            opponent.trash.append(card)
            engine.state.log(opponent.player_id, "effect", "trashed", card_name=card.name)

    def _resolve_rest(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Rest opponent characters."""
        targets = self._select_targets(tmpl, source, player, opponent)
        for target in targets[: tmpl.count]:
            target.state = CardState.RESTED
            engine.state.log(opponent.player_id, "effect", "rested", card_name=target.name)

    def _resolve_power_boost(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Apply power boost."""
        amount = tmpl.amount if tmpl.amount > 0 else 2000
        if tmpl.target == "self":
            source.power_modifier += amount
        else:
            targets = self._select_targets(tmpl, source, player, opponent)
            for target in targets[: tmpl.count]:
                target.power_modifier += amount

    def _resolve_power_reduce(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Apply power reduction to opponent."""
        amount = tmpl.amount if tmpl.amount > 0 else 2000
        targets = self._select_targets(tmpl, source, player, opponent)
        if targets:
            # Target strongest by default
            target = max(targets, key=lambda c: c.effective_power)
            target.power_modifier -= amount
            engine.state.log(
                opponent.player_id,
                "effect",
                "debuffed",
                card_name=target.name,
                amount=-amount,
            )

    def _resolve_play_from_trash(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Play a character from trash to field."""
        candidates = [c for c in player.trash if c.card_type == "CHARACTER"]
        if tmpl.condition:
            candidates = [
                c for c in candidates if self._matches_condition(c, tmpl.condition, source)
            ]
        if not candidates:
            return
        best = max(candidates, key=lambda c: c.cost)
        player.trash.remove(best)
        best.state = CardState.RESTED
        best.power_modifier = 0
        best.attached_don = 0
        player.field.append(best)
        engine.state.log(player.player_id, "effect", "play_from_trash", card_name=best.name)

    def _resolve_don_minus(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Remove DON!! from opponent's available pool."""
        amount = tmpl.amount if tmpl.amount > 0 else 1
        removed = min(amount, opponent.don_field)
        if removed > 0:
            opponent.don_field -= removed
            opponent.don_rested += removed  # Goes to rested pool
            engine.state.log(opponent.player_id, "effect", "don_minus", amount=removed)

    def _resolve_bottom_deck(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Send opponent character to bottom of deck (stronger than bounce)."""
        targets = self._select_targets(tmpl, source, player, opponent)
        for target in targets[: tmpl.count]:
            if target not in opponent.field:
                continue
            opponent.field.remove(target)
            opponent.don_field += target.attached_don
            target.attached_don = 0
            target.power_modifier = 0
            target.state = CardState.ACTIVE
            opponent.deck.append(target)  # Bottom of deck
            engine.state.log(opponent.player_id, "effect", "bottom_deck", card_name=target.name)

    def _resolve_trigger_play(
        self,
        engine: GameEngine,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        """Play a low-cost character from hand for free (trigger effect)."""
        max_cost = 3
        if tmpl.condition and tmpl.condition.cost_lte is not None:
            max_cost = tmpl.condition.cost_lte

        playable = [c for c in player.hand if c.card_type == "CHARACTER" and c.cost <= max_cost]
        if not playable:
            return
        card = max(playable, key=lambda c: c.cost)
        if card not in player.hand:
            return
        player.hand.remove(card)
        card.state = CardState.RESTED
        player.field.append(card)
        engine.state.log(player.player_id, "effect", "trigger_play", card_name=card.name)

    # --- Target selection ---

    def _select_targets(
        self,
        tmpl: EffectTemplate,
        source: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> list[GameCard]:
        """Select valid targets based on template target type and conditions."""
        if tmpl.target == "opponent_character":
            candidates = list(opponent.characters)
        elif tmpl.target == "own_character":
            candidates = list(player.characters)
        elif tmpl.target == "self":
            return [source]
        else:
            candidates = list(opponent.characters)

        # Apply conditions
        if tmpl.condition:
            candidates = [
                c for c in candidates if self._matches_condition(c, tmpl.condition, source)
            ]

        # For rest effects, only target active characters
        if tmpl.type == EffectType.REST:
            candidates = [c for c in candidates if c.state == CardState.ACTIVE]

        # Sort by weakest first (for KO/bounce, prefer targeting weakest matching)
        candidates.sort(key=lambda c: c.effective_power)

        return candidates

    def _matches_condition(
        self,
        target: GameCard,
        condition: EffectCondition,
        source: GameCard,
    ) -> bool:
        """Check if a target card matches the effect condition."""
        if condition.power_lte is not None and target.effective_power > condition.power_lte:
            return False
        if condition.power_gte is not None and target.effective_power < condition.power_gte:
            return False
        if condition.cost_lte is not None and target.cost > condition.cost_lte:
            return False
        if condition.cost_gte is not None and target.cost < condition.cost_gte:
            return False
        if condition.card_type is not None and target.card_type != condition.card_type:
            return False
        if condition.color is not None and condition.color not in target.colors:
            return False
        if condition.is_active is not None:
            expected = CardState.ACTIVE if condition.is_active else CardState.RESTED
            if target.state != expected:
                return False
        if condition.source_cost_multiplier is not None:
            threshold = source.cost * condition.source_cost_multiplier
            if target.effective_power > threshold:
                return False
        return True

    # --- Legacy fallbacks (for cards without parsed templates) ---

    def _legacy_on_play(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        keywords = [k.lower() for k in card.keywords]
        if "draw" in keywords:
            self._draw(engine, player, 1)
        if "search" in keywords:
            self._search(engine, player)
        if "bounce" in keywords:
            self._bounce_lowest(engine, opponent)
        if "ko" in keywords:
            self._ko_weakest(engine, card, opponent)
        if "trash" in keywords:
            self._trash_from_hand(engine, opponent)
        if "rest" in keywords:
            self._rest_opponent(engine, opponent)
        if "power buff" in keywords or "buff" in keywords:
            card.power_modifier += 2000
        if "power debuff" in keywords or "debuff" in keywords:
            self._debuff_opponent(engine, opponent, -2000)

    def _legacy_when_attacking(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        keywords = [k.lower() for k in card.keywords]
        if "draw" in keywords and card.card_type == "LEADER":
            self._draw(engine, player, 1)
        if "power buff" in keywords or "buff" in keywords:
            card.power_modifier += 1000

    def _legacy_on_ko(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        keywords = [k.lower() for k in card.keywords]
        if "draw" in keywords:
            self._draw(engine, player, 1)

    def _legacy_trigger(
        self,
        engine: GameEngine,
        card: GameCard,
        player: PlayerState,
        opponent: PlayerState,
    ) -> None:
        if not card.trigger_effect:
            return
        trigger_lower = card.trigger_effect.lower()
        if "draw" in trigger_lower:
            self._draw(engine, player, 1)
        elif "rest" in trigger_lower:
            self._rest_opponent(engine, opponent)
        elif "play" in trigger_lower:
            self._trigger_play(engine, player)

    # --- Legacy internal implementations ---

    def _draw(self, engine: GameEngine, player: PlayerState, count: int) -> None:
        for _ in range(count):
            if player.deck:
                card = player.deck.pop(0)
                player.hand.append(card)
                engine.state.log(player.player_id, "effect", "draw", card_name=card.name)

    def _search(self, engine: GameEngine, player: PlayerState) -> None:
        if not player.deck:
            return
        top = player.deck[:5]
        if not top:
            return
        best = max(top, key=lambda c: c.cost)
        if best not in player.deck:
            return
        player.deck.remove(best)
        player.hand.append(best)
        self.rng.shuffle(player.deck[:4])
        engine.state.log(player.player_id, "effect", "search", card_name=best.name)

    def _bounce_lowest(self, engine: GameEngine, opponent: PlayerState) -> None:
        chars = opponent.characters
        if not chars:
            return
        lowest = min(chars, key=lambda c: c.cost)
        if lowest not in opponent.field:
            return
        opponent.field.remove(lowest)
        lowest.state = CardState.ACTIVE
        opponent.don_field += lowest.attached_don
        lowest.attached_don = 0
        lowest.power_modifier = 0
        opponent.hand.append(lowest)
        engine.state.log(opponent.player_id, "effect", "bounced", card_name=lowest.name)

    def _ko_weakest(self, engine: GameEngine, source: GameCard, opponent: PlayerState) -> None:
        threshold = source.cost * 1000
        targets = [c for c in opponent.characters if c.effective_power <= threshold]
        if not targets:
            return
        target = min(targets, key=lambda c: c.effective_power)
        if target not in opponent.field:
            return
        opponent.field.remove(target)
        opponent.don_field += target.attached_don
        target.attached_don = 0
        target.power_modifier = 0
        opponent.trash.append(target)
        engine.state.log(opponent.player_id, "effect", "ko", card_name=target.name)

    def _trash_from_hand(self, engine: GameEngine, opponent: PlayerState) -> None:
        if not opponent.hand:
            return
        card = self.rng.choice(opponent.hand)
        opponent.hand.remove(card)
        opponent.trash.append(card)
        engine.state.log(opponent.player_id, "effect", "trashed", card_name=card.name)

    def _rest_opponent(self, engine: GameEngine, opponent: PlayerState) -> None:
        active_chars = [c for c in opponent.characters if c.state == CardState.ACTIVE]
        if not active_chars:
            return
        target = self.rng.choice(active_chars)
        target.state = CardState.RESTED
        engine.state.log(opponent.player_id, "effect", "rested", card_name=target.name)

    def _debuff_opponent(self, engine: GameEngine, opponent: PlayerState, amount: int) -> None:
        chars = opponent.characters
        if not chars:
            return
        target = max(chars, key=lambda c: c.effective_power)
        target.power_modifier += amount
        engine.state.log(
            opponent.player_id,
            "effect",
            "debuffed",
            card_name=target.name,
            amount=amount,
        )

    def _trigger_play(self, engine: GameEngine, player: PlayerState) -> None:
        playable = [c for c in player.hand if c.card_type == "CHARACTER" and c.cost <= 3]
        if not playable:
            return
        card = max(playable, key=lambda c: c.cost)
        if card not in player.hand:
            return
        player.hand.remove(card)
        card.state = CardState.RESTED
        player.field.append(card)
        engine.state.log(player.player_id, "effect", "trigger_play", card_name=card.name)
