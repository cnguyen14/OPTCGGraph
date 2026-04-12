import { useState, useEffect } from 'react';
import type { Card } from '../../types';
import { fetchCard } from '../../lib/api';
import { Modal, Button, Spinner } from '../../components/ui';

export interface SwapSuggestion {
  remove_id: string;
  remove_name: string;
  add_id: string;
  add_name: string;
  reason: string;
  remove_score?: number;
  add_score?: number;
}

interface Props {
  swaps: SwapSuggestion[];
  onApply: (removes: string[], adds: Card[]) => void;
  onClose: () => void;
}

function ScoreBar({ label, score, max, color }: { label: string; score: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-text-muted w-8 text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-text-muted w-5 shrink-0">{score.toFixed(0)}</span>
    </div>
  );
}

function ImprovementBadge({ removeScore, addScore }: { removeScore: number; addScore: number }) {
  if (removeScore <= 0) return null;
  const pctImprove = Math.round(((addScore - removeScore) / removeScore) * 100);
  const isPositive = pctImprove > 0;
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
      isPositive
        ? 'bg-green-900/60 text-green-300'
        : 'bg-red-900/60 text-red-300'
    }`}>
      {isPositive ? '+' : ''}{pctImprove}%
    </span>
  );
}

function CardSlot({
  card,
  name,
  id,
  type,
  score,
  maxScore,
}: {
  card?: Card;
  name: string;
  id: string;
  type: 'remove' | 'add';
  score?: number;
  maxScore: number;
}) {
  const borderColor = type === 'remove' ? 'border-red-500/50' : 'border-green-500/50';
  const labelColor = type === 'remove' ? 'text-red-400' : 'text-green-400';
  const labelText = type === 'remove' ? 'REMOVE' : 'REPLACE WITH';
  const barColor = type === 'remove' ? 'bg-red-500' : 'bg-green-500';

  return (
    <div className="flex-1 min-w-0">
      <div className="flex gap-2">
        {card?.image_small ? (
          <img
            src={card.image_small}
            alt={name}
            className={`w-12 h-[68px] rounded object-cover border-2 ${borderColor} shrink-0`}
          />
        ) : (
          <div className={`w-12 h-[68px] rounded border-2 ${borderColor} bg-surface-2 flex items-center justify-center shrink-0`}>
            <span className="text-[8px] text-text-muted">N/A</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-[9px] font-bold ${labelColor} uppercase tracking-wide`}>{labelText}</p>
          <p className="text-xs text-text-primary font-medium truncate">{name}</p>
          <p className="text-[10px] text-text-muted">{id}</p>
          {card && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {card.cost != null && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-900/40 text-blue-300">
                  {card.cost}⬡
                </span>
              )}
              {card.power != null && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-orange-900/40 text-orange-300">
                  {card.power}
                </span>
              )}
              {card.counter != null && card.counter > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-purple-900/40 text-purple-300">
                  +{card.counter}
                </span>
              )}
            </div>
          )}
          {score !== undefined && (
            <div className="mt-1">
              <ScoreBar label="Fit" score={score} max={maxScore} color={barColor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeckSwapModal({ swaps, onApply, onClose }: Props) {
  const [enabled, setEnabled] = useState<boolean[]>(() => swaps.map(() => true));
  const [cardImages, setCardImages] = useState<Record<string, Card>>({});
  const [loading, setLoading] = useState(true);

  // Fetch card data for images
  useEffect(() => {
    let cancelled = false;
    const ids = new Set<string>();
    for (const s of swaps) {
      ids.add(s.remove_id);
      ids.add(s.add_id);
    }

    Promise.all(
      [...ids].map(id => fetchCard(id).then(c => [id, c] as [string, Card]).catch(() => null))
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, Card> = {};
      for (const r of results) {
        if (r) map[r[0]] = r[1];
      }
      setCardImages(map);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [swaps]);

  const toggleSwap = (idx: number) => {
    setEnabled(prev => prev.map((v, i) => i === idx ? !v : v));
  };

  const enabledCount = enabled.filter(Boolean).length;

  // Calculate max score for consistent bar scaling
  const maxScore = Math.max(
    ...swaps.map(s => Math.max(s.remove_score ?? 0, s.add_score ?? 0)),
    1,
  );

  const handleApply = () => {
    const removes: string[] = [];
    const adds: Card[] = [];
    for (let i = 0; i < swaps.length; i++) {
      if (!enabled[i]) continue;
      removes.push(swaps[i].remove_id);
      const addCard = cardImages[swaps[i].add_id];
      if (addCard) adds.push(addCard);
    }
    onApply(removes, adds);
    onClose();
  };

  return (
    <Modal open={true} onClose={onClose} title={`AI Swap Suggestions (${swaps.length})`} size="lg">
      <p className="text-xs text-text-secondary mb-3">
        These cards could be improved for better synergy and performance. Toggle swaps and apply:
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-3">
          <Spinner size="md" />
          <span className="text-sm text-text-secondary">Loading cards...</span>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {swaps.map((swap, i) => {
            const removeCard = cardImages[swap.remove_id];
            const addCard = cardImages[swap.add_id];

            return (
              <div
                key={i}
                onClick={() => toggleSwap(i)}
                className={`rounded-lg border transition-all cursor-pointer ${
                  enabled[i]
                    ? 'border-blue-500/40 bg-blue-950/15 shadow-[0_0_8px_rgba(59,130,246,0.08)]'
                    : 'border-glass-border bg-surface-1/20 opacity-50'
                }`}
              >
                {/* Header: checkbox + improvement badge */}
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled[i]}
                      onChange={() => toggleSwap(i)}
                      onClick={e => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 shrink-0"
                    />
                    <span className="text-[10px] text-text-muted font-medium">
                      Swap {i + 1} of {swaps.length}
                    </span>
                  </div>
                  {swap.remove_score !== undefined && swap.add_score !== undefined && (
                    <ImprovementBadge removeScore={swap.remove_score} addScore={swap.add_score} />
                  )}
                </div>

                {/* Cards: remove → add */}
                <div className="flex items-stretch gap-2 px-3 pb-2">
                  <CardSlot
                    card={removeCard}
                    name={swap.remove_name}
                    id={swap.remove_id}
                    type="remove"
                    score={swap.remove_score}
                    maxScore={maxScore}
                  />

                  {/* Arrow */}
                  <div className="flex items-center shrink-0 px-1">
                    <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                  </div>

                  <CardSlot
                    card={addCard}
                    name={swap.add_name}
                    id={swap.add_id}
                    type="add"
                    score={swap.add_score}
                    maxScore={maxScore}
                  />
                </div>

                {/* Reason */}
                <div className="px-3 pb-2.5 pt-0">
                  <p className="text-[10px] text-text-secondary leading-relaxed pl-5">
                    {swap.reason}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-glass-border">
          <button
            onClick={() => setEnabled(prev => prev.map(() => !prev.every(Boolean)))}
            className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {enabled.every(Boolean) ? 'Deselect all' : 'Select all'}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Skip
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleApply}
              disabled={enabledCount === 0}
            >
              Apply {enabledCount} Swap{enabledCount !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
