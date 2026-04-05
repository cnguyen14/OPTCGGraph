"""Simulation analysis tools — aggregate and analyze simulation data."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from backend.agent.tools.base import AgentTool, ToolExecutionContext
from backend.simulator.analytics import (
    SIMULATIONS_DIR,
    aggregate_all_simulations,
    compute_detailed_sim_stats,
)

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _handle_analyze_simulations(
    args: dict[str, Any], ctx: ToolExecutionContext
) -> str:
    """Analyze all simulation data and return structured insights."""
    simulations = aggregate_all_simulations()

    if not simulations:
        return json.dumps({"error": "No simulation data found in data/simulations/."})

    question = args.get("question", "")

    # --- Model comparison ---
    model_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "games": 0,
            "wins": 0,
            "total_turns": 0.0,
            "total_damage": 0.0,
            "total_decisions": 0.0,
            "sims": 0,
        }
    )
    for sim in simulations:
        model = sim.get("model") or "unknown"
        stats = sim.get("stats", {})
        n = sim.get("num_games", 0)
        md = model_data[model]
        md["sims"] += 1
        md["games"] += n
        md["wins"] += stats.get("p1_wins", 0)
        md["total_turns"] += stats.get("avg_turns", 0.0) * n
        md["total_damage"] += stats.get("avg_p1_damage", 0.0) * n
        md["total_decisions"] += stats.get("avg_decisions_per_game", 0.0) * n

    model_comparison = []
    for model, md in model_data.items():
        g = md["games"] or 1
        avg_turns = round(md["total_turns"] / g, 2)
        avg_damage = round(md["total_damage"] / g, 2)
        win_rate = round(md["wins"] / g, 4)
        # Efficiency: damage per turn (higher = more aggressive/efficient)
        efficiency = round(avg_damage / avg_turns, 4) if avg_turns else 0.0
        model_comparison.append(
            {
                "model": model,
                "total_games": md["games"],
                "total_sims": md["sims"],
                "win_rate": win_rate,
                "avg_turns": avg_turns,
                "avg_damage": avg_damage,
                "efficiency_score": efficiency,
            }
        )
    model_comparison.sort(key=lambda x: x["win_rate"], reverse=True)

    # --- Top cards across all simulations ---
    global_card_stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"times_played": 0, "games_appeared": 0, "wins": 0}
    )
    for sim in simulations:
        for card_id, cs in sim.get("card_stats", {}).items():
            gcs = global_card_stats[card_id]
            gcs["times_played"] += cs.get("times_played", 0)
            gcs["games_appeared"] += cs.get("games_appeared", 0)
            gcs["wins"] += round(cs.get("win_pct", 0.0) * cs.get("games_appeared", 0))

    top_cards = []
    for card_id, cs in global_card_stats.items():
        appeared = cs["games_appeared"]
        top_cards.append(
            {
                "card_id": card_id,
                "times_played": cs["times_played"],
                "games_appeared": appeared,
                "win_correlation": round(cs["wins"] / appeared, 4) if appeared else 0.0,
            }
        )
    top_cards.sort(key=lambda x: x["times_played"], reverse=True)
    top_cards = top_cards[:20]  # Top 20

    # --- Strategic patterns per model ---
    strategic_patterns: dict[str, dict[str, float]] = {}
    for sim in simulations:
        model = sim.get("model") or "unknown"
        stats = sim.get("stats", {})
        if model not in strategic_patterns:
            strategic_patterns[model] = {
                "play_before_attack_pct": 0.0,
                "don_leader_pct": 0.0,
                "leader_attack_pct": 0.0,
                "count": 0,
            }
        sp = strategic_patterns[model]
        sp["play_before_attack_pct"] += stats.get("play_before_attack_pct", 0.0)
        sp["don_leader_pct"] += stats.get("don_to_leader_pct", 0.0)
        sp["leader_attack_pct"] += stats.get("leader_attack_pct", 0.0)
        sp["count"] += 1

    for model, sp in strategic_patterns.items():
        c = sp.pop("count", 1) or 1
        sp["play_before_attack_pct"] = round(sp["play_before_attack_pct"] / c, 4)
        sp["don_leader_pct"] = round(sp["don_leader_pct"] / c, 4)
        sp["leader_attack_pct"] = round(sp["leader_attack_pct"] / c, 4)

    # --- Generate recommendations ---
    recommendations: list[str] = []

    for mc in model_comparison:
        if mc["win_rate"] > 0.6:
            recommendations.append(
                f"{mc['model']} has a strong win rate ({mc['win_rate']:.0%}) "
                f"across {mc['total_games']} games."
            )
        if mc["efficiency_score"] > 0.6:
            recommendations.append(
                f"{mc['model']} is highly efficient at "
                f"{mc['efficiency_score']:.2f} damage/turn."
            )

    for card in top_cards[:5]:
        if card["win_correlation"] > 0.6:
            recommendations.append(
                f"Card {card['card_id']} appears in winning games "
                f"{card['win_correlation']:.0%} of the time "
                f"(played {card['times_played']} times)."
            )

    for model, sp in strategic_patterns.items():
        if sp["play_before_attack_pct"] > 0.7:
            recommendations.append(
                f"{model} consistently plays cards before attacking "
                f"({sp['play_before_attack_pct']:.0%}), indicating good tempo play."
            )

    if not recommendations:
        recommendations.append("Run more simulations to generate meaningful insights.")

    result = {
        "total_simulations": len(simulations),
        "model_comparison": model_comparison,
        "top_cards": top_cards,
        "strategic_patterns": strategic_patterns,
        "recommendations": recommendations,
    }

    if question:
        result["question"] = question

    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

ANALYZE_SIMULATIONS = AgentTool(
    name="analyze_simulations",
    description=(
        "Analyze all simulation data from data/simulations/ to provide strategic "
        "insights. Returns model comparison (win rates, efficiency), top cards "
        "(play frequency, win correlation), strategic patterns (play-before-attack, "
        "DON allocation, leader targeting), and recommendations. "
        "Use this when users ask about simulation results, model performance, "
        "or card/strategy effectiveness."
    ),
    parameters={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": (
                    "Optional: what the user wants to know about simulations. "
                    "Helps focus the analysis context."
                ),
            },
        },
        "required": [],
    },
    handler=_handle_analyze_simulations,
    category="analysis",
)


async def _handle_analyze_deck_simulation(
    args: dict[str, Any], ctx: ToolExecutionContext
) -> str:
    """Analyze a specific deck's performance from a single simulation."""
    sim_id = args.get("sim_id", "")
    player = args.get("player", "p1")

    if not sim_id:
        return json.dumps({"error": "sim_id is required"})

    # Find simulation folder
    sim_dir = None
    if SIMULATIONS_DIR.exists():
        for d in SIMULATIONS_DIR.iterdir():
            if d.is_dir() and sim_id[:8] in d.name:
                sim_dir = d
                break

    if not sim_dir:
        return json.dumps({"error": f"Simulation {sim_id} not found"})

    # Read metadata for leader info
    metadata: dict[str, Any] = {}
    meta_path = sim_dir / "metadata.json"
    if meta_path.exists():
        try:
            metadata = json.loads(meta_path.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    leader_name = metadata.get(f"{player}_leader", "Unknown")

    # Compute detailed stats
    detailed = compute_detailed_sim_stats(sim_dir.name)
    if not detailed:
        return json.dumps({"error": "Could not compute stats for this simulation"})

    card_perf = detailed.get("card_performance", [])
    num_games = metadata.get("num_games", 0)

    # Generate text recommendations
    recommendations: list[str] = []

    for card in card_perf[:20]:
        name = card["card_name"]
        win_pct = card["win_pct"]
        play_rate = card["play_rate"]
        avg_turn = card["avg_turn_played"]
        times = card["times_played"]

        if win_pct >= 0.75 and times >= 3:
            recommendations.append(
                f"{name} is an MVP ({win_pct:.0%} win rate, "
                f"avg turn {avg_turn}, played {times}x)"
            )
        elif play_rate < 0.3 and num_games >= 5:
            recommendations.append(
                f"{name} is a dead card (only played in "
                f"{card['in_winning_games'] + card['in_losing_games']}/{num_games} games)"
            )
        elif win_pct <= 0.3 and times >= 3:
            recommendations.append(
                f"{name} underperforms ({win_pct:.0%} win rate "
                f"despite being played {times}x) — consider replacing"
            )

    if not recommendations:
        recommendations.append("Not enough data for strong recommendations.")

    result = {
        "sim_id": sim_id,
        "player": player,
        "leader": leader_name,
        "num_games": num_games,
        "card_performance": card_perf[:20],
        "action_patterns": detailed.get("action_patterns", {}),
        "game_summaries": detailed.get("game_summaries", []),
        "turn_momentum": detailed.get("turn_momentum", []),
        "recommendations": recommendations,
    }

    return json.dumps(result, default=str)


ANALYZE_DECK_SIMULATION = AgentTool(
    name="analyze_deck_simulation",
    description=(
        "Analyze a specific deck's performance from a single simulation, "
        "including card timing, action patterns, and strategic recommendations."
    ),
    parameters={
        "type": "object",
        "properties": {
            "sim_id": {
                "type": "string",
                "description": "Simulation ID to analyze",
            },
            "player": {
                "type": "string",
                "enum": ["p1", "p2"],
                "description": "Which player's deck to analyze",
            },
        },
        "required": ["sim_id", "player"],
    },
    handler=_handle_analyze_deck_simulation,
    category="analysis",
)

SIMULATION_TOOLS: list[AgentTool] = [ANALYZE_SIMULATIONS, ANALYZE_DECK_SIMULATION]
