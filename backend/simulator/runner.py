"""Simulation runner — runs multiple games and collects statistics."""

from __future__ import annotations

import logging
import random
from typing import Any, AsyncIterator

from neo4j import AsyncDriver

from backend.graph.queries import get_card_by_id

from .agent import HeuristicAgent, LLMAgent
from .engine import Agent, GameEngine
from .models import CardStat, GameCard, GameResult, SimulationResult
from .template_parser import parse_effects

logger = logging.getLogger(__name__)


async def _load_game_card(
    driver: AsyncDriver, card_id: str, instance_id: str
) -> GameCard:
    """Load a card from Neo4j and convert to GameCard."""
    data = await get_card_by_id(driver, card_id)
    if not data:
        raise ValueError(f"Card not found: {card_id}")

    card_type = data.get("card_type", "CHARACTER")
    cost = data.get("cost", 0) or 0
    keywords = data.get("keywords", [])
    ability_text = data.get("ability", "") or ""
    trigger_effect = data.get("trigger_effect", "") or ""

    effects = parse_effects(
        keywords=keywords,
        ability_text=ability_text,
        trigger_effect=trigger_effect,
        card_type=card_type,
        cost=cost,
    )
    if effects:
        logger.debug(
            "Card %s: %d effects parsed (%s)",
            card_id,
            len(effects),
            ", ".join(e.type.value for e in effects),
        )

    return GameCard(
        instance_id=instance_id,
        card_id=card_id,
        name=data.get("name", "Unknown"),
        card_type=card_type,
        cost=cost,
        power=data.get("power", 0) or 0,
        counter=data.get("counter", 0) or 0,
        keywords=keywords,
        ability_text=ability_text,
        trigger_effect=trigger_effect,
        colors=data.get("colors", []) or [],
        effects=effects,
    )


async def load_deck(
    driver: AsyncDriver, leader_id: str, card_ids: list[str], player: str
) -> tuple[GameCard, list[GameCard]]:
    """Load leader and deck cards from Neo4j."""
    leader = await _load_game_card(driver, leader_id, f"{player}-leader")

    deck: list[GameCard] = []
    for i, card_id in enumerate(card_ids):
        card = await _load_game_card(driver, card_id, f"{player}-{i:02d}")
        deck.append(card)

    return leader, deck


def _clone_cards(
    leader: GameCard, deck: list[GameCard]
) -> tuple[GameCard, list[GameCard]]:
    """Deep-clone leader and deck for a fresh game."""
    import copy

    new_leader = copy.deepcopy(leader)
    new_deck = copy.deepcopy(deck)
    return new_leader, new_deck


class SimulationRunner:
    """Runs N games between two decks and collects statistics.

    Parameters
    ----------
    mode : "virtual" (rule-based, free) or "real" (LLM-powered, costs $)
    p1_level : "new" | "amateur" | "pro"
    p2_level : "easy" | "medium" | "hard"
    llm_model : Claude model ID (only used in real mode)
    """

    def __init__(
        self,
        driver: AsyncDriver,
        mode: str = "virtual",
        p1_level: str = "amateur",
        p2_level: str = "medium",
        llm_model: str | None = None,
        base_seed: int = 42,
    ) -> None:
        self.driver = driver
        self.mode = mode
        self.p1_level = p1_level
        self.p2_level = p2_level
        self.llm_model = llm_model
        self.base_seed = base_seed

    async def run(
        self,
        deck1_leader_id: str,
        deck1_card_ids: list[str],
        deck2_leader_id: str,
        deck2_card_ids: list[str],
        num_games: int = 10,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run simulation, yielding progress events via SSE."""
        yield {"type": "loading", "message": "Loading decks from database..."}

        p1_leader, p1_deck = await load_deck(
            self.driver, deck1_leader_id, deck1_card_ids, "p1"
        )
        p2_leader, p2_deck = await load_deck(
            self.driver, deck2_leader_id, deck2_card_ids, "p2"
        )

        yield {
            "type": "loaded",
            "p1_leader": p1_leader.name,
            "p2_leader": p2_leader.name,
        }

        # Create agents based on mode
        rng = random.Random(self.base_seed)

        if self.mode == "real":
            model = self.llm_model or "claude-haiku-4-5-20251001"
            p1_agent: Agent = LLMAgent(role="player", level=self.p1_level, model=model)
            p2_agent: Agent = LLMAgent(role="bot", level=self.p2_level, model=model)
        else:
            # Virtual mode — rule-based agents
            p1_rng = random.Random(rng.randint(0, 2**32))
            p2_rng = random.Random(rng.randint(0, 2**32))
            p1_agent = HeuristicAgent(role="player", level=self.p1_level, rng=p1_rng)
            p2_agent = HeuristicAgent(role="bot", level=self.p2_level, rng=p2_rng)

        results: list[GameResult] = []
        p1_wins = 0
        p2_wins = 0
        draws = 0

        for game_num in range(1, num_games + 1):
            seed = self.base_seed + game_num
            engine = GameEngine(seed=seed)

            l1, d1 = _clone_cards(p1_leader, p1_deck)
            l2, d2 = _clone_cards(p2_leader, p2_deck)

            engine.init_game(l1, d1, l2, d2)
            result = await engine.run_game(p1_agent, p2_agent)
            results.append(result)

            if result.winner == "p1":
                p1_wins += 1
            elif result.winner == "p2":
                p2_wins += 1
            else:
                draws += 1

            yield {
                "type": "game_complete",
                "game": game_num,
                "total": num_games,
                "winner": result.winner,
                "turns": result.turns,
                "p1_wins": p1_wins,
                "p2_wins": p2_wins,
                "draws": draws,
                "p1_life": result.p1_life_remaining,
                "p2_life": result.p2_life_remaining,
                "first_player": result.first_player,
                "game_log": result.game_log[:200],
            }

        # Aggregate stats
        card_stats = self._aggregate_card_stats(results)
        avg_turns = sum(r.turns for r in results) / max(len(results), 1)

        sim_result = SimulationResult(
            num_games=num_games,
            p1_wins=p1_wins,
            p2_wins=p2_wins,
            draws=draws,
            avg_turns=avg_turns,
            p1_leader=p1_leader.name,
            p2_leader=p2_leader.name,
            card_stats={k: v.__dict__ for k, v in card_stats.items()},  # type: ignore[assignment,misc]
            sample_games=results[:3],
        )

        yield {
            "type": "complete",
            "result": {
                "num_games": sim_result.num_games,
                "p1_wins": sim_result.p1_wins,
                "p2_wins": sim_result.p2_wins,
                "draws": sim_result.draws,
                "avg_turns": round(sim_result.avg_turns, 1),
                "p1_leader": sim_result.p1_leader,
                "p2_leader": sim_result.p2_leader,
                "p1_win_rate": round(sim_result.p1_win_rate * 100, 1),
                "p2_win_rate": round(sim_result.p2_win_rate * 100, 1),
                "card_stats": sim_result.card_stats,
                "sample_games": [
                    {
                        "winner": g.winner,
                        "turns": g.turns,
                        "p1_life": g.p1_life_remaining,
                        "p2_life": g.p2_life_remaining,
                        "game_log": g.game_log[:200],
                    }
                    for g in sim_result.sample_games
                ],
            },
        }

    def _aggregate_card_stats(self, results: list[GameResult]) -> dict[str, CardStat]:
        """Aggregate card performance across all games."""
        stats: dict[str, CardStat] = {}

        for result in results:
            for card_id, times in result.p1_cards_played.items():
                if card_id not in stats:
                    stats[card_id] = CardStat(card_id=card_id, card_name=card_id)
                s = stats[card_id]
                s.times_played += times
                s.total_games += 1
                if result.winner == "p1":
                    s.times_in_winning_game += 1

            for card_id, times in result.p2_cards_played.items():
                if card_id not in stats:
                    stats[card_id] = CardStat(card_id=card_id, card_name=card_id)
                s = stats[card_id]
                s.times_played += times
                s.total_games += 1
                if result.winner == "p2":
                    s.times_in_winning_game += 1

        return stats
