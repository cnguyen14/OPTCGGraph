import { useState, useEffect } from 'react';
import type { SimulationProgress as ProgressData } from '../../types';

interface Props {
  progress: ProgressData;
  p1Leader: string | null;
  p2Leader: string | null;
  startedAt: number | null;
}

function formatTime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SimulationProgress({ progress, p1Leader, p2Leader, startedAt }: Props) {
  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  const [now, setNow] = useState(Date.now());

  // Tick every second for elapsed timer
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = startedAt ? now - startedAt : 0;
  const eta =
    progress.completed > 0
      ? ((progress.total - progress.completed) / progress.completed) * elapsed
      : null;

  const p1Rate = progress.completed > 0 ? Math.round((progress.p1Wins / progress.completed) * 100) : 0;
  const p2Rate = progress.completed > 0 ? Math.round((progress.p2Wins / progress.completed) * 100) : 0;

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Battle Progress
        </h3>
        <span className="text-xs text-gray-400">
          {progress.completed}/{progress.total} games
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-gray-800 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Timer row */}
      {startedAt && (
        <div className="flex items-center gap-3 mb-4 text-[11px] text-gray-500">
          <span>Elapsed: {formatTime(elapsed)}</span>
          {eta !== null && <span>ETA: ~{formatTime(eta)}</span>}
          {progress.completed > 0 && (
            <span className="ml-auto">
              {(elapsed / progress.completed / 1000).toFixed(1)}s / game
            </span>
          )}
        </div>
      )}

      {/* Score */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-blue-400">{progress.p1Wins}</div>
          <div className="text-[11px] text-gray-400 mt-1">{p1Leader || 'Player 1'}</div>
          {progress.completed > 0 && (
            <div className="text-[10px] text-blue-400/60 mt-0.5">{p1Rate}%</div>
          )}
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-500">{progress.draws}</div>
          <div className="text-[11px] text-gray-400 mt-1">Draws</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-400">{progress.p2Wins}</div>
          <div className="text-[11px] text-gray-400 mt-1">{p2Leader || 'Player 2'}</div>
          {progress.completed > 0 && (
            <div className="text-[10px] text-red-400/60 mt-0.5">{p2Rate}%</div>
          )}
        </div>
      </div>
    </div>
  );
}
