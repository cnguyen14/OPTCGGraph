"""Simulation runner — runs multiple games and collects statistics."""

from __future__ import annotations

import logging
import random
from typing import Any, AsyncIterator

from neo4j import AsyncDriver

from backend.graph.queries import get_card_by_id

from .agent import HeuristicAgent, LLMAgent
from .data_export import SimulationDataExporter
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
        image=data.get("image_small", "") or data.get("image_large", "") or "",
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
        self.exporter = SimulationDataExporter()

    async def run(
        self,
        deck1_leader_id: str,
        deck1_card_ids: list[str],
        deck2_leader_id: str,
        deck2_card_ids: list[str],
        num_games: int = 10,
        sim_id: str = "",
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
                "win_condition": result.win_condition,
                "p1_mulligan": result.p1_mulligan,
                "p2_mulligan": result.p2_mulligan,
                "p1_effects_fired": result.p1_effects_fired,
                "p2_effects_fired": result.p2_effects_fired,
                "p1_damage": result.p1_total_damage_dealt,
                "p2_damage": result.p2_total_damage_dealt,
                "decision_count": len(result.decision_points),
                "game_log": result.game_log[:200],
            }

        # Aggregate stats
        card_stats = self._aggregate_card_stats(results)
        enhanced = self._aggregate_enhanced_stats(results)
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

        # Export data to JSONL
        export_path = ""
        if sim_id:
            try:
                export_dir = self.exporter.export_simulation(
                    sim_id=sim_id,
                    results=results,
                    metadata={
                        "p1_leader": p1_leader.name,
                        "p1_leader_id": deck1_leader_id,
                        "p2_leader": p2_leader.name,
                        "p2_leader_id": deck2_leader_id,
                        "num_games": num_games,
                        "mode": self.mode,
                        "p1_level": self.p1_level,
                        "p2_level": self.p2_level,
                        "llm_model": self.llm_model,
                        "base_seed": self.base_seed,
                    },
                )
                export_path = str(export_dir)
            except Exception as e:
                logger.warning("Failed to export simulation data: %s", e)

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
                "enhanced_stats": enhanced,
                "export_path": export_path,
                "sample_games": [
                    {
                        "winner": g.winner,
                        "turns": g.turns,
                        "p1_life": g.p1_life_remaining,
                        "p2_life": g.p2_life_remaining,
                        "win_condition": g.win_condition,
                        "p1_mulligan": g.p1_mulligan,
                        "p2_mulligan": g.p2_mulligan,
                        "p1_effects": g.p1_effects_fired,
                        "p2_effects": g.p2_effects_fired,
                        "p1_damage": g.p1_total_damage_dealt,
                        "p2_damage": g.p2_total_damage_dealt,
                        "decision_count": len(g.decision_points),
                        "turn_snapshots": [s.to_dict() for s in g.turn_snapshots],
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

    def _aggregate_enhanced_stats(self, results: list[GameResult]) -> dict[str, Any]:
        """Aggregate enhanced statistics across all games."""
        n = max(len(results), 1)

        # Mulligan stats
        p1_mulligans = sum(1 for r in results if r.p1_mulligan)
        p2_mulligans = sum(1 for r in results if r.p2_mulligan)
        mulligan_wins = sum(
            1
            for r in results
            if (r.p1_mulligan and r.winner == "p1")
            or (r.p2_mulligan and r.winner == "p2")
        )
        total_mulligans = p1_mulligans + p2_mulligans

        # Win condition breakdown
        win_by_lethal = sum(1 for r in results if r.win_condition == "lethal")
        win_by_deckout = sum(1 for r in results if r.win_condition == "deck_out")
        win_by_timeout = sum(1 for r in results if r.win_condition == "timeout")

        # First player advantage
        first_player_wins = sum(1 for r in results if r.winner == r.first_player)

        # Effects and damage
        avg_effects = sum(r.p1_effects_fired + r.p2_effects_fired for r in results) / n
        avg_p1_damage = sum(r.p1_total_damage_dealt for r in results) / n
        avg_p2_damage = sum(r.p2_total_damage_dealt for r in results) / n

        # Decision counts
        total_decisions = sum(len(r.decision_points) for r in results)

        return {
            "mulligan_rate_p1": round(p1_mulligans / n, 3),
            "mulligan_rate_p2": round(p2_mulligans / n, 3),
            "mulligan_win_rate": (
                round(mulligan_wins / total_mulligans, 3) if total_mulligans > 0 else 0
            ),
            "win_by_lethal": win_by_lethal,
            "win_by_deckout": win_by_deckout,
            "win_by_timeout": win_by_timeout,
            "first_player_win_rate": round(first_player_wins / n, 3),
            "avg_effects_per_game": round(avg_effects, 1),
            "avg_p1_damage": round(avg_p1_damage, 1),
            "avg_p2_damage": round(avg_p2_damage, 1),
            "total_decisions": total_decisions,
            "avg_decisions_per_game": round(total_decisions / n, 1),
        }
