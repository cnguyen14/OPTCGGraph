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
    <Modal open={true} onClose={onClose} title="Suggested Card Swaps" size="lg">
      <p className="text-xs text-text-secondary mb-4">
        Some cards in your deck could be improved. Select which swaps to apply:
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-3">
          <Spinner size="md" />
          <span className="text-sm text-text-secondary">Loading cards...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {swaps.map((swap, i) => {
            const removeCard = cardImages[swap.remove_id];
            const addCard = cardImages[swap.add_id];

            return (
              <div
                key={i}
                className={`rounded-lg border transition-colors ${
                  enabled[i]
                    ? 'border-blue-500/40 bg-blue-950/20'
                    : 'border-glass-border bg-surface-1/30 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={enabled[i]}
                    onChange={() => toggleSwap(i)}
                    className="mt-3 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 shrink-0"
                  />

                  {/* Remove card */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {removeCard?.image_small ? (
                      <img
                        src={removeCard.image_small}
                        alt={swap.remove_name}
                        className="w-10 h-14 rounded object-cover border-2 border-red-500/50 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-14 rounded border-2 border-red-500/50 bg-surface-2 flex items-center justify-center shrink-0">
                        <span className="text-[8px] text-text-muted">N/A</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[10px] text-red-400 font-medium">REMOVE</p>
                      <p className="text-xs text-text-primary truncate">{swap.remove_name}</p>
                      <p className="text-[10px] text-text-muted">{swap.remove_id}</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center shrink-0 px-2 pt-3">
                    <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>

                  {/* Add card */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {addCard?.image_small ? (
                      <img
                        src={addCard.image_small}
                        alt={swap.add_name}
                        className="w-10 h-14 rounded object-cover border-2 border-green-500/50 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-14 rounded border-2 border-green-500/50 bg-surface-2 flex items-center justify-center shrink-0">
                        <span className="text-[8px] text-text-muted">N/A</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[10px] text-green-400 font-medium">ADD</p>
                      <p className="text-xs text-text-primary truncate">{swap.add_name}</p>
                      <p className="text-[10px] text-text-muted">{swap.add_id}</p>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div className="px-3 pb-2 pl-10">
                  <p className="text-[11px] text-text-secondary italic">{swap.reason}</p>
                  {swap.remove_score !== undefined && swap.add_score !== undefined && (
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Score: <span className="text-red-400">{swap.remove_score}</span>
                      {' → '}
                      <span className="text-green-400">{swap.add_score}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-glass-border">
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
      )}
    </Modal>
  );
}
