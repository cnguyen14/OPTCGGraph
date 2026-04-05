"""Shared analytics logic for simulation data aggregation."""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Base path for simulation data (relative to project root)
SIMULATIONS_DIR = Path("data/simulations")


def _parse_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file and return a list of parsed dicts."""
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("Skipping malformed JSONL line in %s", path)
    return records


def _compute_game_stats(games: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute aggregate stats from games.jsonl records."""
    if not games:
        return {}

    n = len(games)
    p1_wins = sum(1 for g in games if g.get("winner") == "p1")
    p2_wins = sum(1 for g in games if g.get("winner") == "p2")
    draws = n - p1_wins - p2_wins

    turns = [g.get("turns", 0) for g in games]
    p1_damage = [g.get("p1_damage_dealt", 0) for g in games]
    p2_damage = [g.get("p2_damage_dealt", 0) for g in games]
    p1_life = [g.get("p1_life", 0) for g in games]

    first_player_games = [g for g in games if g.get("first_player")]
    first_player_wins = sum(
        1 for g in first_player_games if g.get("winner") == g.get("first_player")
    )
    first_player_win_rate = (
        first_player_wins / len(first_player_games) if first_player_games else 0.0
    )

    p1_mulligans = sum(1 for g in games if g.get("p1_mulligan"))
    p2_mulligans = sum(1 for g in games if g.get("p2_mulligan"))

    return {
        "p1_wins": p1_wins,
        "p2_wins": p2_wins,
        "draws": draws,
        "p1_win_rate": round(p1_wins / n, 4) if n else 0.0,
        "avg_turns": round(sum(turns) / n, 2) if n else 0.0,
        "avg_p1_damage": round(sum(p1_damage) / n, 2) if n else 0.0,
        "avg_p2_damage": round(sum(p2_damage) / n, 2) if n else 0.0,
        "avg_p1_life_remaining": round(sum(p1_life) / n, 2) if n else 0.0,
        "first_player_win_rate": round(first_player_win_rate, 4),
        "p1_mulligan_rate": round(p1_mulligans / n, 4) if n else 0.0,
        "p2_mulligan_rate": round(p2_mulligans / n, 4) if n else 0.0,
    }


def _compute_decision_stats(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute aggregate stats from decisions.jsonl records."""
    if not decisions:
        return {}

    # Group by game_idx
    games_decisions: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for d in decisions:
        games_decisions[d.get("game_idx", 0)].append(d)

    n_games = len(games_decisions) if games_decisions else 1
    total_decisions = len(decisions)
    avg_decisions_per_game = round(total_decisions / n_games, 2)

    # Action distribution
    action_counts: dict[str, int] = defaultdict(int)
    for d in decisions:
        action = d.get("action", "unknown")
        action_counts[action] += 1

    action_distribution = {
        k: round(v / total_decisions, 4) for k, v in action_counts.items()
    }

    # Leader attack percentage (attacks targeting leader)
    attacks = [d for d in decisions if d.get("action") == "attack"]
    leader_attacks = sum(
        1 for a in attacks if a.get("desc") and "leader" in a["desc"].lower()
    )
    leader_attack_pct = round(leader_attacks / len(attacks), 4) if attacks else 0.0

    # DON to leader percentage
    don_attachments = [d for d in decisions if d.get("action") == "attach_don"]
    don_to_leader = sum(
        1
        for da in don_attachments
        if da.get("desc") and ("Yamato" in da["desc"] or "Mihawk" in da["desc"])
    )
    don_to_leader_pct = (
        round(don_to_leader / len(don_attachments), 4) if don_attachments else 0.0
    )

    # Losing attack percentage (attacker power < target power)
    power_pattern = re.compile(r"\((\d+)\s*vs\s*(\d+)\)")
    losing_attacks = 0
    attacks_with_power = 0
    for a in attacks:
        desc = a.get("desc", "")
        m = power_pattern.search(desc)
        if m:
            attacks_with_power += 1
            attacker_power = int(m.group(1))
            target_power = int(m.group(2))
            if attacker_power < target_power:
                losing_attacks += 1

    losing_attack_pct = (
        round(losing_attacks / attacks_with_power, 4) if attacks_with_power else 0.0
    )

    # Play before attack percentage (per turn)
    # Group decisions by (game_idx, turn)
    turn_decisions: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for d in decisions:
        key = (d.get("game_idx", 0), d.get("turn", 0))
        turn_decisions[key].append(d)

    turns_with_both = 0
    play_before_attack_count = 0
    for _key, turn_decs in turn_decisions.items():
        actions_in_turn = [d.get("action") for d in turn_decs]
        has_play = "play_card" in actions_in_turn
        has_attack = "attack" in actions_in_turn
        if has_play and has_attack:
            turns_with_both += 1
            first_play = next(
                i for i, a in enumerate(actions_in_turn) if a == "play_card"
            )
            first_attack = next(
                i for i, a in enumerate(actions_in_turn) if a == "attack"
            )
            if first_play < first_attack:
                play_before_attack_count += 1

    play_before_attack_pct = (
        round(play_before_attack_count / turns_with_both, 4) if turns_with_both else 0.0
    )

    return {
        "avg_decisions_per_game": avg_decisions_per_game,
        "action_distribution": action_distribution,
        "leader_attack_pct": leader_attack_pct,
        "don_to_leader_pct": don_to_leader_pct,
        "losing_attack_pct": losing_attack_pct,
        "play_before_attack_pct": play_before_attack_pct,
    }


def _compute_turn_momentum(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute average p1_eval and p2_eval per turn across all games."""
    if not snapshots:
        return []

    turn_evals: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for s in snapshots:
        turn = s.get("turn", 0)
        p1_eval = s.get("p1", {}).get("eval", 0.0)
        p2_eval = s.get("p2", {}).get("eval", 0.0)
        turn_evals[turn].append((p1_eval, p2_eval))

    momentum = []
    for turn in sorted(turn_evals.keys()):
        evals = turn_evals[turn]
        n = len(evals)
        avg_p1 = round(sum(e[0] for e in evals) / n, 2)
        avg_p2 = round(sum(e[1] for e in evals) / n, 2)
        momentum.append({"turn": turn, "avg_p1_eval": avg_p1, "avg_p2_eval": avg_p2})

    return momentum


def _compute_card_stats(
    games: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Compute per-card stats from games.jsonl p1/p2_cards_played."""
    card_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"times_played": 0, "games_appeared": 0, "wins": 0, "total_games": 0}
    )

    for g in games:
        winner = g.get("winner")
        for player_key in ("p1_cards_played", "p2_cards_played"):
            cards_played = g.get(player_key, {})
            is_winner = (player_key == "p1_cards_played" and winner == "p1") or (
                player_key == "p2_cards_played" and winner == "p2"
            )
            seen_this_game: set[str] = set()
            for card_id, count in cards_played.items():
                card_data[card_id]["times_played"] += count
                if card_id not in seen_this_game:
                    card_data[card_id]["games_appeared"] += 1
                    card_data[card_id]["total_games"] += 1
                    if is_winner:
                        card_data[card_id]["wins"] += 1
                    seen_this_game.add(card_id)

    result: dict[str, dict[str, Any]] = {}
    for card_id, stats in card_data.items():
        appeared = stats["games_appeared"]
        result[card_id] = {
            "card_id": card_id,
            "times_played": stats["times_played"],
            "games_appeared": appeared,
            "win_pct": round(stats["wins"] / appeared, 4) if appeared else 0.0,
        }

    return result


def _compute_per_card_detail(
    decisions: list[dict[str, Any]], games: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Compute per-card performance detail from decisions and games data.

    Extracts card names from play_card decisions and correlates with win/loss
    outcomes to produce per-card metrics.
    """
    if not decisions:
        return []

    # Build game_idx -> outcome map
    game_outcomes: dict[int, str] = {}
    for g in games:
        game_outcomes[g.get("game_idx", 0)] = g.get("winner", "")

    # Also build from decisions (each decision has outcome field)
    for d in decisions:
        gidx = d.get("game_idx", 0)
        if gidx not in game_outcomes:
            game_outcomes[gidx] = d.get("outcome", "")

    num_games = len(game_outcomes) if game_outcomes else 1

    # Extract card name from desc like "Play Tonoyasu (cost 2)" -> "Tonoyasu"
    play_pattern = re.compile(r"^Play\s+(.+?)\s*\(cost\s+\d+\)")

    # Per-card data: {card_name: {times_played, turns, winning_games, losing_games}}
    card_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "times_played": 0,
            "turns": [],
            "winning_games": set(),
            "losing_games": set(),
        }
    )

    for d in decisions:
        if d.get("action") != "play_card":
            continue
        desc = d.get("desc", "")
        m = play_pattern.match(desc)
        if not m:
            continue
        card_name = m.group(1).strip()
        game_idx = d.get("game_idx", 0)
        turn = d.get("turn", 0)
        player = d.get("player", "p1")
        outcome = d.get("outcome", game_outcomes.get(game_idx, ""))

        cd = card_data[card_name]
        cd["times_played"] += 1
        cd["turns"].append(turn)

        if outcome == player:
            cd["winning_games"].add(game_idx)
        elif outcome and outcome != "draw":
            cd["losing_games"].add(game_idx)

    result: list[dict[str, Any]] = []
    for card_name, cd in card_data.items():
        times_played = cd["times_played"]
        in_winning = len(cd["winning_games"])
        in_losing = len(cd["losing_games"])
        total_appearances = in_winning + in_losing
        turns_list = cd["turns"]
        avg_turn = round(sum(turns_list) / len(turns_list), 2) if turns_list else 0.0

        result.append(
            {
                "card_name": card_name,
                "times_played": times_played,
                "play_rate": round(times_played / num_games, 2),
                "avg_turn_played": avg_turn,
                "in_winning_games": in_winning,
                "in_losing_games": in_losing,
                "win_pct": (
                    round(in_winning / total_appearances, 4)
                    if total_appearances
                    else 0.0
                ),
            }
        )

    result.sort(key=lambda x: x["times_played"], reverse=True)
    return result


def _compute_critical_turns(
    snapshots: list[dict[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    """Find critical turns where abs(life_delta) > 1 between consecutive snapshots.

    Returns {game_idx: [critical_turn_info, ...]}.
    """
    if not snapshots:
        return {}

    # Group by game_idx, sort by turn
    game_snaps: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for s in snapshots:
        game_snaps[s.get("game_idx", 0)].append(s)

    critical: dict[int, list[dict[str, Any]]] = {}
    for game_idx, snaps in game_snaps.items():
        snaps.sort(key=lambda x: x.get("turn", 0))
        game_critical: list[dict[str, Any]] = []
        for i in range(1, len(snaps)):
            prev = snaps[i - 1]
            curr = snaps[i]
            p1_prev_life = prev.get("p1", {}).get("life", 0)
            p1_curr_life = curr.get("p1", {}).get("life", 0)
            p2_prev_life = prev.get("p2", {}).get("life", 0)
            p2_curr_life = curr.get("p2", {}).get("life", 0)
            p1_delta = p1_curr_life - p1_prev_life
            p2_delta = p2_curr_life - p2_prev_life

            if abs(p1_delta) > 1 or abs(p2_delta) > 1:
                game_critical.append(
                    {
                        "turn": curr.get("turn", 0),
                        "p1_life_delta": p1_delta,
                        "p2_life_delta": p2_delta,
                        "p1_life": p1_curr_life,
                        "p2_life": p2_curr_life,
                    }
                )
        if game_critical:
            critical[game_idx] = game_critical

    return critical


def _build_game_summaries(
    games: list[dict[str, Any]],
    critical_turns: dict[int, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Build simplified per-game summaries with critical turns."""
    summaries: list[dict[str, Any]] = []
    for g in games:
        game_idx = g.get("game_idx", 0)
        summaries.append(
            {
                "game_idx": game_idx,
                "winner": g.get("winner", ""),
                "turns": g.get("turns", 0),
                "p1_life": g.get("p1_life", 0),
                "p2_life": g.get("p2_life", 0),
                "win_condition": g.get("win_condition", ""),
                "critical_turns": critical_turns.get(game_idx, []),
            }
        )
    return summaries


def compute_detailed_sim_stats(sim_folder: str) -> dict[str, Any] | None:
    """Compute detailed stats for a single simulation folder.

    Reads all 3 data files (games, decisions, snapshots) and returns
    card performance, turn momentum, action patterns, and game summaries.
    """
    sim_dir = SIMULATIONS_DIR / sim_folder
    if not sim_dir.exists():
        # Try to find by partial match
        if SIMULATIONS_DIR.exists():
            for d in SIMULATIONS_DIR.iterdir():
                if d.is_dir() and sim_folder in d.name:
                    sim_dir = d
                    break
            else:
                return None
        else:
            return None

    games = _parse_jsonl(sim_dir / "games.jsonl")
    decisions = _parse_jsonl(sim_dir / "decisions.jsonl")
    snapshots = _parse_jsonl(sim_dir / "snapshots.jsonl")

    if not games:
        return None

    card_performance = _compute_per_card_detail(decisions, games)
    turn_momentum = _compute_turn_momentum(snapshots)
    decision_stats = _compute_decision_stats(decisions)
    critical_turns = _compute_critical_turns(snapshots)
    game_summaries = _build_game_summaries(games, critical_turns)

    # Extract a useful subset of action patterns
    action_patterns: dict[str, Any] = {}
    if decision_stats:
        action_patterns = {
            "action_distribution": decision_stats.get("action_distribution", {}),
            "leader_attack_pct": decision_stats.get("leader_attack_pct", 0.0),
            "losing_attack_pct": decision_stats.get("losing_attack_pct", 0.0),
            "play_before_attack_pct": decision_stats.get("play_before_attack_pct", 0.0),
            "avg_decisions_per_game": decision_stats.get("avg_decisions_per_game", 0.0),
        }

    return {
        "card_performance": card_performance,
        "turn_momentum": turn_momentum,
        "action_patterns": action_patterns,
        "game_summaries": game_summaries,
    }


def aggregate_simulation(sim_dir: Path) -> dict[str, Any] | None:
    """Aggregate all data for a single simulation directory.

    Returns None if metadata.json is missing or unreadable.
    """
    meta_path = sim_dir / "metadata.json"
    if not meta_path.exists():
        return None

    try:
        with meta_path.open() as f:
            metadata = json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("Failed to read metadata from %s", meta_path)
        return None

    games = _parse_jsonl(sim_dir / "games.jsonl")
    decisions = _parse_jsonl(sim_dir / "decisions.jsonl")
    snapshots = _parse_jsonl(sim_dir / "snapshots.jsonl")

    game_stats = _compute_game_stats(games)
    decision_stats = _compute_decision_stats(decisions)
    turn_momentum = _compute_turn_momentum(snapshots)
    card_stats = _compute_card_stats(games)

    return {
        "sim_id": metadata.get("sim_id", ""),
        "folder": metadata.get("folder", sim_dir.name),
        "timestamp": metadata.get("timestamp", ""),
        "model": metadata.get("llm_model", ""),
        "mode": metadata.get("mode", ""),
        "p1_leader": metadata.get("p1_leader", ""),
        "p2_leader": metadata.get("p2_leader", ""),
        "p1_level": metadata.get("p1_level", ""),
        "p2_level": metadata.get("p2_level", ""),
        "num_games": metadata.get("num_games", 0),
        "stats": {**game_stats, **decision_stats},
        "card_stats": card_stats,
        "turn_momentum": turn_momentum,
    }


def aggregate_deck_health(sim_folders: list[str]) -> dict[str, Any]:
    """Aggregate stats across multiple simulation folders for holistic deck health.

    Returns per-card stats, co-occurrence synergy pairs, matchup spread,
    and aggregated action patterns.
    """
    all_games: list[dict[str, Any]] = []
    all_decisions: list[dict[str, Any]] = []
    matchup_results: dict[str, dict[str, int]] = defaultdict(
        lambda: {"wins": 0, "total": 0}
    )

    for folder in sim_folders:
        sim_dir = SIMULATIONS_DIR / folder
        if not sim_dir.exists():
            # Try partial match
            if SIMULATIONS_DIR.exists():
                for d in SIMULATIONS_DIR.iterdir():
                    if d.is_dir() and folder in d.name:
                        sim_dir = d
                        break
                else:
                    continue
            else:
                continue

        meta_path = sim_dir / "metadata.json"
        opponent = ""
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                opponent = meta.get("p2_leader", "unknown")
            except (json.JSONDecodeError, OSError):
                pass

        games = _parse_jsonl(sim_dir / "games.jsonl")
        decisions = _parse_jsonl(sim_dir / "decisions.jsonl")

        for g in games:
            g["_opponent"] = opponent
            all_games.append(g)
            mr = matchup_results[opponent]
            mr["total"] += 1
            if g.get("winner") == "p1":
                mr["wins"] += 1

        all_decisions.extend(decisions)

    if not all_games:
        return {}

    total_games = len(all_games)
    total_wins = sum(1 for g in all_games if g.get("winner") == "p1")

    # --- Per-card stats (P1 only) ---
    card_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"times_played": 0, "games_appeared": 0, "wins": 0}
    )
    # Also track per-game card sets for co-occurrence
    game_card_sets: list[tuple[set[str], bool]] = []  # (card_ids_in_game, is_win)

    for g in all_games:
        cards_played = g.get("p1_cards_played", {})
        is_win = g.get("winner") == "p1"
        seen: set[str] = set()
        for card_id, count in cards_played.items():
            card_data[card_id]["times_played"] += count
            if card_id not in seen:
                card_data[card_id]["games_appeared"] += 1
                if is_win:
                    card_data[card_id]["wins"] += 1
                seen.add(card_id)
        game_card_sets.append((set(cards_played.keys()), is_win))

    card_health: list[dict[str, Any]] = []
    for card_id, stats in card_data.items():
        appeared = stats["games_appeared"]
        play_rate = round(appeared / total_games, 4) if total_games else 0.0
        win_corr = round(stats["wins"] / appeared, 4) if appeared else 0.0
        card_health.append({
            "card_id": card_id,
            "times_played": stats["times_played"],
            "play_rate": play_rate,
            "win_correlation": win_corr,
            "games_appeared": appeared,
        })
    card_health.sort(key=lambda x: x["times_played"], reverse=True)

    # --- Co-occurrence synergy pairs (in winning games) ---
    # Filter to cards with >10% play rate
    frequent_cards = {
        c["card_id"]
        for c in card_health
        if c["play_rate"] > 0.1
    }
    pair_wins: dict[tuple[str, str], int] = defaultdict(int)
    pair_total: dict[tuple[str, str], int] = defaultdict(int)
    for card_set, is_win in game_card_sets:
        freq_in_game = sorted(card_set & frequent_cards)
        for i in range(len(freq_in_game)):
            for j in range(i + 1, len(freq_in_game)):
                pair = (freq_in_game[i], freq_in_game[j])
                pair_total[pair] += 1
                if is_win:
                    pair_wins[pair] += 1

    overall_win_rate = total_wins / total_games if total_games else 0.0
    synergy_pairs: list[dict[str, Any]] = []
    for pair, total in pair_total.items():
        if total < 3:  # Need minimum co-occurrences
            continue
        pair_win_rate = pair_wins[pair] / total if total else 0.0
        lift = pair_win_rate / overall_win_rate if overall_win_rate > 0 else 1.0
        synergy_pairs.append({
            "card_a": pair[0],
            "card_b": pair[1],
            "co_occurrence_rate": round(total / total_games, 4),
            "win_lift": round(lift, 4),
        })
    synergy_pairs.sort(key=lambda x: x["win_lift"], reverse=True)
    synergy_pairs = synergy_pairs[:10]

    # --- Matchup spread ---
    matchup_spread: list[dict[str, Any]] = []
    for opponent, mr in matchup_results.items():
        matchup_spread.append({
            "opponent": opponent,
            "win_rate": round(mr["wins"] / mr["total"], 4) if mr["total"] else 0.0,
            "num_games": mr["total"],
        })
    matchup_spread.sort(key=lambda x: x["num_games"], reverse=True)

    # --- Aggregated action patterns ---
    decision_stats = _compute_decision_stats(all_decisions)

    return {
        "total_games": total_games,
        "total_wins": total_wins,
        "overall_win_rate": round(overall_win_rate, 4),
        "card_health": card_health[:30],  # Top 30
        "top_synergies": synergy_pairs,
        "matchup_spread": matchup_spread,
        "action_patterns": {
            "play_before_attack_pct": decision_stats.get("play_before_attack_pct", 0.0),
            "leader_attack_pct": decision_stats.get("leader_attack_pct", 0.0),
            "losing_attack_pct": decision_stats.get("losing_attack_pct", 0.0),
            "avg_decisions_per_game": decision_stats.get("avg_decisions_per_game", 0.0),
        },
    }


def aggregate_all_simulations() -> list[dict[str, Any]]:
    """Scan all simulation directories and return aggregated data.

    Returns a list sorted by timestamp descending (newest first).
    """
    if not SIMULATIONS_DIR.exists():
        return []

    results: list[dict[str, Any]] = []
    for sim_dir in SIMULATIONS_DIR.iterdir():
        if not sim_dir.is_dir():
            continue
        agg = aggregate_simulation(sim_dir)
        if agg is not None:
            results.append(agg)

    # Sort by timestamp descending
    results.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return results
