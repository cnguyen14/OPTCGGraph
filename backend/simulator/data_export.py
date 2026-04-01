"""JSONL export pipeline for simulation data.

Exports simulation results to JSONL files for ML training,
deck analysis, and debugging.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import GameResult

logger = logging.getLogger(__name__)

DEFAULT_OUTPUT_DIR = "data/simulations"


class SimulationDataExporter:
    """Export simulation data to JSONL files."""

    def __init__(self, output_dir: str = DEFAULT_OUTPUT_DIR) -> None:
        self.output_dir = Path(output_dir)

    def export_simulation(
        self,
        sim_id: str,
        results: list[GameResult],
        metadata: dict[str, Any],
    ) -> Path:
        """Write entire simulation run to JSONL files.

        Creates directory: {output_dir}/{sim_id}/
        With files:
          - metadata.json     (simulation config)
          - decisions.jsonl    (1 DecisionPoint per line)
          - games.jsonl        (1 game summary per line)
          - snapshots.jsonl    (1 TurnSnapshot per line)

        Returns the simulation directory path.
        """
        # Folder name: timestamp_sim_id_short for easy management
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
        short_id = sim_id[:8]
        folder_name = f"{timestamp}_{short_id}"
        sim_dir = self.output_dir / folder_name
        sim_dir.mkdir(parents=True, exist_ok=True)

        # metadata.json — add timestamp and folder info
        metadata["timestamp"] = datetime.now(timezone.utc).isoformat()
        metadata["sim_id"] = sim_id
        metadata["folder"] = folder_name
        meta_path = sim_dir / "metadata.json"
        meta_path.write_text(json.dumps(metadata, indent=2, default=str))

        # decisions.jsonl — training data
        decisions_path = sim_dir / "decisions.jsonl"
        decision_count = 0
        with decisions_path.open("w") as f:
            for game_idx, result in enumerate(results):
                for dp in result.decision_points:
                    record = dp.to_dict()
                    record["game_idx"] = game_idx
                    record["outcome"] = result.winner
                    record["game_turns"] = result.turns
                    f.write(json.dumps(record) + "\n")
                    decision_count += 1

        # games.jsonl — per-game summaries
        games_path = sim_dir / "games.jsonl"
        with games_path.open("w") as f:
            for game_idx, result in enumerate(results):
                record = {
                    "game_idx": game_idx,
                    "winner": result.winner,
                    "turns": result.turns,
                    "first_player": result.first_player,
                    "p1_life": result.p1_life_remaining,
                    "p2_life": result.p2_life_remaining,
                    "win_condition": result.win_condition,
                    "p1_mulligan": result.p1_mulligan,
                    "p2_mulligan": result.p2_mulligan,
                    "p1_damage_dealt": result.p1_total_damage_dealt,
                    "p2_damage_dealt": result.p2_total_damage_dealt,
                    "p1_effects_fired": result.p1_effects_fired,
                    "p2_effects_fired": result.p2_effects_fired,
                    "p1_cards_played": result.p1_cards_played,
                    "p2_cards_played": result.p2_cards_played,
                    "decision_count": len(result.decision_points),
                }
                f.write(json.dumps(record) + "\n")

        # snapshots.jsonl — turn-by-turn board state
        snapshots_path = sim_dir / "snapshots.jsonl"
        with snapshots_path.open("w") as f:
            for game_idx, result in enumerate(results):
                for snap in result.turn_snapshots:
                    record = snap.to_dict()
                    record["game_idx"] = game_idx
                    f.write(json.dumps(record) + "\n")

        logger.info(
            "Exported sim %s: %d games, %d decisions, %d snapshots → %s",
            sim_id,
            len(results),
            decision_count,
            sum(len(r.turn_snapshots) for r in results),
            sim_dir,
        )

        return sim_dir
