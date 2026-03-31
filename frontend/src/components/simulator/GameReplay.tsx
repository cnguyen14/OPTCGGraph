import { useState } from 'react';
import type { SampleGame, GameReplayEntry } from '../../types';

interface Props {
  games: SampleGame[];
}

export default function GameReplay({ games }: Props) {
  const [activeGame, setActiveGame] = useState(0);

  if (games.length === 0) return null;

  const game = games[activeGame];
  const significantEvents = game.game_log.filter(
    (e) =>
      e.action !== 'start' &&
      e.action !== 'game_initialized' &&
      e.phase !== 'effect',
  );

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Game Replay</h3>
        <div className="flex gap-1">
          {games.map((g, i) => (
            <button
              key={i}
              onClick={() => setActiveGame(i)}
              className={`text-[11px] px-2.5 py-1 rounded ${
                activeGame === i
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Game {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Game summary */}
      <div className="flex items-center gap-4 mb-3 text-[11px]">
        <span className={game.winner === 'p1' ? 'text-blue-400 font-bold' : 'text-gray-400'}>
          P1 ({game.p1_life} life)
        </span>
        <span className="text-gray-600">vs</span>
        <span className={game.winner === 'p2' ? 'text-red-400 font-bold' : 'text-gray-400'}>
          P2 ({game.p2_life} life)
        </span>
        <span className="text-gray-600 ml-auto">{game.turns} turns</span>
      </div>

      {/* Event log */}
      <div className="space-y-0.5 max-h-72 overflow-y-auto text-[11px] font-mono">
        {significantEvents.map((event, i) => (
          <ReplayLine key={i} event={event} />
        ))}
      </div>
    </div>
  );
}

function ReplayLine({ event }: { event: GameReplayEntry }) {
  const playerColor = event.player === 'p1' ? 'text-blue-400' : event.player === 'p2' ? 'text-red-400' : 'text-gray-500';
  const details = event.details;

  let description = event.action;
  if (event.action === 'play_card' || event.action === 'play_event') {
    description = `plays ${details.card_name || '?'} (cost ${details.cost || '?'})`;
  } else if (event.action === 'attack_declared') {
    description = `${details.attacker || '?'} attacks ${details.target || '?'} (${details.attacker_power || '?'} vs ${details.target_power || '?'})`;
  } else if (event.action === 'life_lost') {
    description = `loses life (${details.remaining || 0} remaining)`;
  } else if (event.action === 'character_koed') {
    description = `${details.card_name || '?'} KO'd`;
  } else if (event.action === 'attach_don') {
    description = `attach DON to ${details.card_name || '?'} (${details.new_power || '?'} power)`;
  } else if (event.action === 'final_blow') {
    description = `FINAL BLOW with ${details.attacker || '?'}!`;
  } else if (event.action === 'blocker_used') {
    description = `blocks with ${details.blocker || '?'}`;
  } else if (event.action === 'counter_played') {
    description = `counters with ${details.card_name || '?'} (+${details.counter_value || 0})`;
  } else if (event.action === 'pass') {
    description = 'passes';
  } else if (event.action === 'draw_card') {
    description = `draws ${details.card_name || 'a card'}`;
  }

  return (
    <div className="flex gap-2 py-0.5 hover:bg-gray-800/30 px-1 rounded">
      <span className="text-gray-600 w-8 shrink-0">T{event.turn}</span>
      <span className={`w-6 shrink-0 ${playerColor}`}>{event.player.toUpperCase()}</span>
      <span className="text-gray-300">{description}</span>
    </div>
  );
}
