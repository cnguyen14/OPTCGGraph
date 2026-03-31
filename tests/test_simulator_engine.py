"""Unit tests for the OPTCG Battle Simulator game engine."""

import pytest

from backend.simulator.models import (
    ActionType,
    CardState,
    GameAction,
    GameCard,
    GameState,
    Phase,
    PlayerState,
)
from backend.simulator.engine import GameEngine
from backend.simulator.effects import EffectHandler


# --- Helpers ---

def make_card(
    instance_id: str = "p1-01",
    card_id: str = "OP01-001",
    name: str = "Test Card",
    card_type: str = "CHARACTER",
    cost: int = 3,
    power: int = 5000,
    counter: int = 1000,
    keywords: list[str] | None = None,
    ability_text: str = "",
    trigger_effect: str = "",
    color: str = "Red",
    state: CardState = CardState.ACTIVE,
) -> GameCard:
    return GameCard(
        instance_id=instance_id,
        card_id=card_id,
        name=name,
        card_type=card_type,
        cost=cost,
        power=power,
        counter=counter,
        keywords=keywords or [],
        ability_text=ability_text,
        trigger_effect=trigger_effect,
        color=color,
        state=state,
    )


def make_leader(player: str = "p1", name: str = "Luffy", power: int = 5000) -> GameCard:
    return make_card(
        instance_id=f"{player}-leader",
        card_id=f"OP01-{player}",
        name=name,
        card_type="LEADER",
        cost=0,
        power=power,
        counter=0,
    )


def make_deck(player: str = "p1", size: int = 40) -> list[GameCard]:
    """Generate a simple test deck."""
    cards = []
    for i in range(size):
        cards.append(make_card(
            instance_id=f"{player}-{i:02d}",
            card_id=f"OP01-{100+i:03d}",
            name=f"Card {i}",
            cost=(i % 5) + 1,
            power=((i % 5) + 1) * 1000,
            counter=1000 if i % 3 == 0 else 0,
            keywords=["Blocker"] if i % 10 == 0 else [],
            trigger_effect="Draw 1" if i % 8 == 0 else "",
        ))
    return cards


class DummyAgent:
    """Always picks the first legal action (or pass)."""

    async def choose_main_action(self, state: GameState, legal_actions: list[GameAction]) -> int:
        # Prefer playing cards, then attacking, then pass
        for i, a in enumerate(legal_actions):
            if a.action_type == ActionType.PLAY_CARD:
                return i
        for i, a in enumerate(legal_actions):
            if a.action_type == ActionType.ATTACK:
                return i
        return len(legal_actions) - 1  # Pass

    async def choose_blockers(self, state, blockers, attacker, target) -> GameCard | None:
        return None  # Never block

    async def choose_counters(self, state, hand, attacker, target, power_gap) -> list[GameCard]:
        return []  # Never counter


class SmartDummyAgent:
    """Slightly smarter: plays highest cost card, attaches DON, attacks leader."""

    async def choose_main_action(self, state: GameState, legal_actions: list[GameAction]) -> int:
        # Play highest cost card first
        play_actions = [(i, a) for i, a in enumerate(legal_actions) if a.action_type == ActionType.PLAY_CARD]
        if play_actions:
            return play_actions[-1][0]  # Last play action tends to be highest cost due to hand order

        # Then attack leader
        for i, a in enumerate(legal_actions):
            if a.action_type == ActionType.ATTACK and "Leader" in a.description:
                return i

        # Then any attack
        for i, a in enumerate(legal_actions):
            if a.action_type == ActionType.ATTACK:
                return i

        return len(legal_actions) - 1  # Pass

    async def choose_blockers(self, state, blockers, attacker, target) -> GameCard | None:
        # Block if a blocker has more power than attacker
        for b in blockers:
            if b.effective_power >= attacker.effective_power:
                return b
        return None

    async def choose_counters(self, state, hand, attacker, target, power_gap) -> list[GameCard]:
        if power_gap <= 0:
            return []  # Already safe
        # Use minimum counters to survive
        counters = []
        total = 0
        for card in sorted(hand, key=lambda c: c.counter, reverse=True):
            if card.counter > 0 and total < power_gap:
                counters.append(card)
                total += card.counter
                if total >= power_gap:
                    break
        return counters if total >= power_gap else []


# =====================
# Test: Game Initialization
# =====================

class TestGameInit:
    def test_init_creates_valid_state(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        assert state.p1.player_id == "p1"
        assert state.p2.player_id == "p2"
        assert len(state.p1.life) == 5
        assert len(state.p2.life) == 5
        assert len(state.p1.hand) == 5
        assert len(state.p2.hand) == 5
        # 40 - 5 life - 5 hand = 30 remaining in deck
        assert len(state.p1.deck) == 30
        assert len(state.p2.deck) == 30
        assert state.turn == 0
        assert state.winner is None

    def test_init_shuffles_deck(self):
        deck1a = make_deck("p1")
        deck1b = [make_card(
            instance_id=c.instance_id, card_id=c.card_id, name=c.name,
            cost=c.cost, power=c.power, counter=c.counter,
        ) for c in deck1a]

        engine_a = GameEngine(seed=1)
        engine_b = GameEngine(seed=2)

        state_a = engine_a.init_game(make_leader("p1"), deck1a, make_leader("p2"), make_deck("p2"))
        state_b = engine_b.init_game(make_leader("p1"), deck1b, make_leader("p2"), make_deck("p2"))

        # Different seeds should give different hand orders
        hand_a = [c.instance_id for c in state_a.p1.hand]
        hand_b = [c.instance_id for c in state_b.p1.hand]
        assert hand_a != hand_b

    def test_don_deck_starts_at_10(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        assert state.p1.don_deck == 10
        assert state.p2.don_deck == 10
        assert state.p1.don_field == 0
        assert state.p2.don_field == 0


# =====================
# Test: Phases
# =====================

class TestPhases:
    def test_refresh_unrests_cards(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"

        # Rest leader and a field card
        state.p1.leader.state = CardState.RESTED
        card = make_card(instance_id="p1-field-01", state=CardState.RESTED)
        card.attached_don = 2
        state.p1.field.append(card)

        engine._refresh_phase()

        assert state.p1.leader.state == CardState.ACTIVE
        assert card.state == CardState.ACTIVE
        assert card.attached_don == 0
        assert state.p1.don_field == 2  # DON returned

    def test_draw_phase_draws_card(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 2  # Not turn 1
        state.active_player_id = "p1"
        hand_before = len(state.p1.hand)

        engine._draw_phase()

        assert len(state.p1.hand) == hand_before + 1

    def test_draw_phase_skip_turn1(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 1
        state.active_player_id = "p1"
        hand_before = len(state.p1.hand)

        engine._draw_phase()

        assert len(state.p1.hand) == hand_before  # No draw

    def test_don_phase_adds_don(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        assert state.p1.don_field == 0
        assert state.p1.don_deck == 10

        engine._don_phase()

        assert state.p1.don_field == 2
        assert state.p1.don_deck == 8

    def test_don_phase_caps_at_10(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 9
        state.p1.don_deck = 5

        engine._don_phase()

        assert state.p1.don_field == 10  # Only added 1
        assert state.p1.don_deck == 4


# =====================
# Test: Legal Actions
# =====================

class TestLegalActions:
    def test_pass_always_available(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        engine.state = state

        actions = engine._get_legal_actions()
        pass_actions = [a for a in actions if a.action_type == ActionType.PASS]
        assert len(pass_actions) == 1

    def test_play_card_if_affordable(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 5
        # Add a known card to hand
        cheap = make_card(instance_id="p1-cheap", cost=2, name="Cheap Card")
        expensive = make_card(instance_id="p1-expensive", cost=8, name="Expensive Card")
        state.p1.hand.extend([cheap, expensive])
        engine.state = state

        actions = engine._get_legal_actions()
        play_actions = [a for a in actions if a.action_type == ActionType.PLAY_CARD]

        playable_ids = [a.source_id for a in play_actions]
        assert "p1-cheap" in playable_ids
        assert "p1-expensive" not in playable_ids

    def test_attack_with_active_characters(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.turn = 2  # Must be > 1 so attacks are allowed
        active_char = make_card(instance_id="p1-atk", state=CardState.ACTIVE, name="Attacker")
        rested_char = make_card(instance_id="p1-rested", state=CardState.RESTED, name="Rested")
        state.p1.field.extend([active_char, rested_char])
        engine.state = state

        actions = engine._get_legal_actions()
        attack_actions = [a for a in actions if a.action_type == ActionType.ATTACK]

        attacker_ids = {a.source_id for a in attack_actions}
        assert "p1-atk" in attacker_ids
        assert "p1-rested" not in attacker_ids
        # Leader should also be able to attack
        assert "p1-leader" in attacker_ids

    def test_can_only_attack_rested_characters(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.turn = 2  # Must be > 1 so attacks are allowed
        opp_active = make_card(instance_id="p2-act", state=CardState.ACTIVE, name="Active Opp")
        opp_rested = make_card(instance_id="p2-rest", state=CardState.RESTED, name="Rested Opp")
        state.p2.field.extend([opp_active, opp_rested])
        engine.state = state

        actions = engine._get_legal_actions()
        attack_targets = {a.target_id for a in actions if a.action_type == ActionType.ATTACK}

        assert "p2-rest" in attack_targets
        assert "p2-act" not in attack_targets
        assert "p2-leader" in attack_targets  # Leader always targetable


# =====================
# Test: Combat Resolution
# =====================

class TestCombat:
    @pytest.mark.asyncio
    async def test_attack_leader_removes_life(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1", power=6000), make_deck("p1"),
            make_leader("p2", power=5000), make_deck("p2"),
        )
        state.turn = 2
        state.active_player_id = "p1"
        state.p1.don_field = 2
        life_before = len(state.p2.life)

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-leader",
            target_id="p2-leader",
        )
        agents = {"p1": DummyAgent(), "p2": DummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        assert len(state.p2.life) == life_before - 1

    @pytest.mark.asyncio
    async def test_attack_fails_if_weaker(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1", power=3000), make_deck("p1"),
            make_leader("p2", power=8000), make_deck("p2"),
        )
        state.turn = 2
        state.active_player_id = "p1"
        life_before = len(state.p2.life)

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-leader",
            target_id="p2-leader",
        )
        agents = {"p1": DummyAgent(), "p2": DummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        assert len(state.p2.life) == life_before  # No damage

    @pytest.mark.asyncio
    async def test_ko_character(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        attacker = make_card(instance_id="p1-atk", power=7000, state=CardState.ACTIVE)
        target = make_card(instance_id="p2-target", power=5000, state=CardState.RESTED)
        state.p1.field.append(attacker)
        state.p2.field.append(target)

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-atk",
            target_id="p2-target",
        )
        agents = {"p1": DummyAgent(), "p2": DummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        assert target not in state.p2.field
        assert target in state.p2.trash

    @pytest.mark.asyncio
    async def test_double_attack_removes_two_life(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2", power=3000), make_deck("p2"),
        )
        state.active_player_id = "p1"
        attacker = make_card(
            instance_id="p1-double", power=8000,
            state=CardState.ACTIVE, keywords=["Double Attack"],
        )
        state.p1.field.append(attacker)
        life_before = len(state.p2.life)

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-double",
            target_id="p2-leader",
        )
        agents = {"p1": DummyAgent(), "p2": DummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        assert len(state.p2.life) == life_before - 2

    @pytest.mark.asyncio
    async def test_counter_prevents_damage(self):
        """SmartDummyAgent uses counters to prevent damage."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1", power=6000), make_deck("p1"),
            make_leader("p2", power=5000), make_deck("p2"),
        )
        state.active_player_id = "p1"
        # Give p2 a 2000 counter card
        counter_card = make_card(
            instance_id="p2-counter", counter=2000, name="Counter Card"
        )
        state.p2.hand.append(counter_card)
        life_before = len(state.p2.life)

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-leader",
            target_id="p2-leader",
        )
        # SmartDummy will use counter since gap is 1000 and counter is 2000
        agents = {"p1": DummyAgent(), "p2": SmartDummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        # Counter of 2000 makes defense 7000 > attack 6000 → attack fails
        assert len(state.p2.life) == life_before
        assert counter_card in state.p2.trash


# =====================
# Test: Card Playing
# =====================

class TestCardPlaying:
    @pytest.mark.asyncio
    async def test_play_character(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 5

        card = make_card(instance_id="p1-play", cost=3, name="Played Card")
        state.p1.hand.append(card)

        action = GameAction(action_type=ActionType.PLAY_CARD, source_id="p1-play")
        await engine._play_card(action, state.p1, state.p2)

        assert card in state.p1.field
        assert card not in state.p1.hand
        assert card.state == CardState.RESTED  # Enters rested
        assert state.p1.don_field == 2  # Paid 3

    @pytest.mark.asyncio
    async def test_play_rush_character_enters_active(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 5

        rush_card = make_card(
            instance_id="p1-rush", cost=3, name="Rush Card",
            keywords=["Rush"],
        )
        state.p1.hand.append(rush_card)

        action = GameAction(action_type=ActionType.PLAY_CARD, source_id="p1-rush")
        await engine._play_card(action, state.p1, state.p2)

        assert rush_card.state == CardState.ACTIVE

    @pytest.mark.asyncio
    async def test_play_event_goes_to_trash(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 3

        event = make_card(
            instance_id="p1-event", cost=2, name="Event Card",
            card_type="EVENT",
        )
        state.p1.hand.append(event)

        action = GameAction(action_type=ActionType.PLAY_CARD, source_id="p1-event")
        await engine._play_card(action, state.p1, state.p2)

        assert event not in state.p1.field
        assert event in state.p1.trash


# =====================
# Test: DON!! Management
# =====================

class TestDonManagement:
    def test_attach_don_to_leader(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 3

        action = GameAction(
            action_type=ActionType.ATTACH_DON,
            target_id="p1-leader",
        )
        engine._attach_don(action, state.p1)

        assert state.p1.leader.attached_don == 1
        assert state.p1.leader.effective_power == 6000  # 5000 + 1000
        assert state.p1.don_field == 2

    def test_attach_don_to_character(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"
        state.p1.don_field = 3

        char = make_card(instance_id="p1-char", power=4000)
        state.p1.field.append(char)

        action = GameAction(action_type=ActionType.ATTACH_DON, target_id="p1-char")
        engine._attach_don(action, state.p1)

        assert char.attached_don == 1
        assert char.effective_power == 5000


# =====================
# Test: Win Conditions
# =====================

class TestWinConditions:
    @pytest.mark.asyncio
    async def test_game_ends_when_life_zero_and_leader_hit(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1", power=9000), make_deck("p1"),
            make_leader("p2", power=3000), make_deck("p2"),
        )
        state.active_player_id = "p1"
        # Remove all life from p2
        state.p2.life.clear()

        action = GameAction(
            action_type=ActionType.ATTACK,
            source_id="p1-leader",
            target_id="p2-leader",
        )
        agents = {"p1": DummyAgent(), "p2": DummyAgent()}
        await engine._resolve_attack(action, state.p1, state.p2, agents)

        assert state.winner == "p1"

    def test_max_turns_safety(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 51
        assert state.is_game_over()


# =====================
# Test: Effects
# =====================

class TestEffects:
    def test_draw_effect(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"

        card = make_card(keywords=["Draw"])
        hand_before = len(state.p1.hand)
        engine.effects.resolve_on_play(engine, card, state.p1, state.p2)

        assert len(state.p1.hand) == hand_before + 1

    def test_bounce_effect(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"

        target = make_card(instance_id="p2-bounce", cost=2, name="Bounce Target")
        state.p2.field.append(target)

        card = make_card(keywords=["Bounce"])
        engine.effects.resolve_on_play(engine, card, state.p1, state.p2)

        assert target not in state.p2.field
        assert target in state.p2.hand

    def test_ko_effect(self):
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.active_player_id = "p1"

        weak = make_card(instance_id="p2-weak", power=2000, name="Weak Card")
        state.p2.field.append(weak)

        card = make_card(cost=5, keywords=["KO"])  # threshold = 5000
        engine.effects.resolve_on_play(engine, card, state.p1, state.p2)

        assert weak not in state.p2.field
        assert weak in state.p2.trash

    def test_rush_keyword(self):
        handler = EffectHandler()
        card = make_card(keywords=["Rush"])
        assert handler.has_rush(card)

    def test_blocker_keyword(self):
        handler = EffectHandler()
        card = make_card(keywords=["Blocker"])
        assert handler.has_blocker(card)

    def test_effective_power_with_don_and_modifier(self):
        card = make_card(power=5000)
        card.attached_don = 2
        card.power_modifier = 1000
        assert card.effective_power == 8000  # 5000 + 2000 + 1000


# =====================
# Test: Full Game
# =====================

class TestFullGame:
    @pytest.mark.asyncio
    async def test_full_game_completes(self):
        """Run a full game with dummy agents — must terminate with a winner."""
        engine = GameEngine(seed=42)
        engine.init_game(
            make_leader("p1", power=5000), make_deck("p1", size=40),
            make_leader("p2", power=5000), make_deck("p2", size=40),
        )

        result = await engine.run_game(SmartDummyAgent(), SmartDummyAgent())

        assert result.winner in ("p1", "p2", "draw")
        assert result.turns > 0
        assert len(result.game_log) > 0

    @pytest.mark.asyncio
    async def test_deterministic_with_same_seed(self):
        """Same seed should produce identical results."""
        results = []
        for _ in range(2):
            engine = GameEngine(seed=123)
            engine.init_game(
                make_leader("p1"), make_deck("p1"),
                make_leader("p2"), make_deck("p2"),
            )
            result = await engine.run_game(DummyAgent(), DummyAgent())
            results.append(result)

        assert results[0].winner == results[1].winner
        assert results[0].turns == results[1].turns

    @pytest.mark.asyncio
    async def test_game_log_records_events(self):
        engine = GameEngine(seed=42)
        engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        result = await engine.run_game(DummyAgent(), DummyAgent())

        assert len(result.game_log) > 10  # Should have many events
        # First entry should be setup
        assert result.game_log[0]["action"] == "game_initialized"


# =====================
# Test: First Turn Rules
# =====================

class TestFirstTurnRules:
    """Verify OPTCG rules: first player turn 1 gets 1 DON and cannot attack."""

    def test_turn1_no_attack_actions(self):
        """First player cannot attack on turn 1."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 1
        state.active_player_id = "p1"
        # Even with active characters on field, no attacks should be legal
        active_char = make_card(instance_id="p1-atk", state=CardState.ACTIVE, name="Attacker")
        state.p1.field.append(active_char)
        engine.state = state

        actions = engine._get_legal_actions()
        attack_actions = [a for a in actions if a.action_type == ActionType.ATTACK]
        assert len(attack_actions) == 0, "First player must NOT be allowed to attack on turn 1"

    def test_turn1_only_1_don_added(self):
        """Turn 1 should only add 1 DON (not 2)."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 1
        state.active_player_id = "p1"
        assert state.p1.don_field == 0
        assert state.p1.don_deck == 10

        engine._don_phase()

        assert state.p1.don_field == 1, "Turn 1 should only add 1 DON"
        assert state.p1.don_deck == 9

    def test_turn2_gets_2_don(self):
        """Turn 2+ should add 2 DON."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 2
        state.active_player_id = "p1"
        assert state.p1.don_field == 0

        engine._don_phase()

        assert state.p1.don_field == 2, "Turn 2 should add 2 DON"
        assert state.p1.don_deck == 8

    def test_turn2_attacks_allowed(self):
        """Turn 2+ should allow attack actions."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        state.turn = 2
        state.active_player_id = "p1"
        engine.state = state

        actions = engine._get_legal_actions()
        attack_actions = [a for a in actions if a.action_type == ActionType.ATTACK]
        assert len(attack_actions) > 0, "Attacks should be allowed from turn 2 onward"

    @pytest.mark.asyncio
    async def test_full_game_turn1_no_attack(self):
        """Run a full game and verify the first turn has no attack log entries."""
        engine = GameEngine(seed=42)
        engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        result = await engine.run_game(SmartDummyAgent(), SmartDummyAgent())

        # Find turn 1 log entries - there should be no attack_declared on turn 1
        in_turn_1 = False
        for entry in result.game_log:
            if entry.get("action") == "start" and entry.get("turn") == 1:
                in_turn_1 = True
            elif entry.get("action") == "start" and entry.get("turn", 0) > 1:
                in_turn_1 = False
            if in_turn_1 and entry.get("action") == "attack_declared":
                pytest.fail("Attack was declared during turn 1, which is not allowed")


# =====================
# Test: Coin Flip Randomness
# =====================

class TestCoinFlip:
    """Verify coin flip randomness and first_player tracking."""

    def test_coin_flip_sets_first_player(self):
        """init_game must set first_player_id."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        assert state.first_player_id in ("p1", "p2")
        assert state.active_player_id == state.first_player_id

    def test_game_initialized_log_has_first_player(self):
        """The game_initialized log entry must record first_player."""
        engine = GameEngine(seed=42)
        state = engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        init_entry = None
        for entry in state.game_log:
            d = entry.to_dict()
            if d.get("action") == "game_initialized":
                init_entry = d
                break

        assert init_entry is not None, "game_initialized log entry not found"
        # first_player may be top-level or nested in details
        first_player = init_entry.get("first_player") or init_entry.get("details", {}).get("first_player")
        assert first_player is not None, "first_player missing from game_initialized log"
        assert first_player in ("p1", "p2")

    def test_coin_flip_not_always_p1(self):
        """Different seeds should produce different first players (not always p1)."""
        first_players = set()
        for seed in range(50):
            engine = GameEngine(seed=seed)
            state = engine.init_game(
                make_leader("p1"), make_deck("p1"),
                make_leader("p2"), make_deck("p2"),
            )
            first_players.add(state.first_player_id)
            if len(first_players) == 2:
                break  # Both p1 and p2 observed

        assert first_players == {"p1", "p2"}, (
            f"Coin flip always returned {first_players}; expected both p1 and p2"
        )

    @pytest.mark.asyncio
    async def test_first_player_in_game_result(self):
        """GameResult must track which player went first."""
        engine = GameEngine(seed=42)
        engine.init_game(
            make_leader("p1"), make_deck("p1"),
            make_leader("p2"), make_deck("p2"),
        )
        result = await engine.run_game(DummyAgent(), DummyAgent())

        assert hasattr(result, "first_player"), "GameResult missing first_player field"
        assert result.first_player in ("p1", "p2")

    @pytest.mark.asyncio
    async def test_coin_flip_statistical_fairness(self):
        """Over many games, coin flip should be roughly 50/50."""
        counts = {"p1": 0, "p2": 0}
        for seed in range(100):
            engine = GameEngine(seed=seed)
            state = engine.init_game(
                make_leader("p1"), make_deck("p1"),
                make_leader("p2"), make_deck("p2"),
            )
            counts[state.first_player_id] += 1

        # With 100 trials, each should be at least 30 (very generous margin)
        assert counts["p1"] >= 30, f"p1 went first only {counts['p1']}/100 times"
        assert counts["p2"] >= 30, f"p2 went first only {counts['p2']}/100 times"
