import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { loadSavedDeck, updateDeck } from '../../lib/api';

// Click card image to show large preview
function CardPreviewOverlay({ image, name, onClose }: { image: string; name: string; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center cursor-pointer" onClick={onClose}>
      <img src={image} alt={name} className="max-h-[80vh] max-w-[90vw] rounded-xl shadow-2xl" />
    </div>,
    document.body,
  );
}

interface SwapCandidate {
  card_id: string;
  name: string;
  image: string;
  power: number | null;
  cost: number | null;
  counter: number | null;
  synergy_score: number;
}

export interface SwapWithCandidates {
  remove: string;
  remove_name: string;
  remove_image: string;
  role_needed: string;
  reason: string;
  candidates: SwapCandidate[];
}

interface SwapConfirmModalProps {
  deckId: string;
  deckName: string;
  leaderId: string;
  swaps: SwapWithCandidates[];
  onClose: () => void;
  onSaved: () => void;
  onSimulate?: () => void;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  blocker: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-500/40' },
  removal: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/40' },
  finisher: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-500/40' },
  draw: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/40' },
  rush: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-500/40' },
  counter: { bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-500/40' },
};

function getRoleStyle(role: string) {
  return ROLE_COLORS[role.toLowerCase()] ?? { bg: 'bg-gray-700/40', text: 'text-gray-400', border: 'border-gray-600/40' };
}

export default function SwapConfirmModal({
  deckId,
  deckName,
  leaderId,
  swaps,
  onClose,
  onSaved,
  onSimulate,
}: SwapConfirmModalProps) {
  const [enabled, setEnabled] = useState<boolean[]>(() => swaps.map((s) => (s.candidates?.length ?? 0) > 0));
  // candidateQtys[swapIdx][card_id] = quantity to add for that candidate
  const [candidateQtys, setCandidateQtys] = useState<Record<number, Record<string, number>>>({});
  const [deckEntries, setDeckEntries] = useState<{ card_id: string; quantity: number }[]>([]);
  const [swapQty, setSwapQty] = useState<Record<number, number>>({});  // how many copies to swap per index
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<{ image: string; name: string } | null>(null);
  const [success, setSuccess] = useState(false);

  // Load deck entries on mount
  useEffect(() => {
    let cancelled = false;
    loadSavedDeck(deckId)
      .then((deck) => {
        if (!cancelled) {
          setDeckEntries(deck.entries);
          // Default swap quantity = how many copies of remove card in deck
          const qtyInit: Record<number, number> = {};
          const cqInit: Record<number, Record<string, number>> = {};
          swaps.forEach((swap, i) => {
            const entry = deck.entries.find((e) => e.card_id === swap.remove);
            const qty = entry ? entry.quantity : 1;
            qtyInit[i] = qty;
            // Default: all copies go to first candidate
            const m: Record<string, number> = {};
            (swap.candidates ?? []).forEach((c, j) => { m[c.card_id] = j === 0 ? qty : 0; });
            cqInit[i] = m;
          });
          setSwapQty(qtyInit);
          setCandidateQtys(cqInit);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [deckId]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const toggleSwap = useCallback((index: number) => {
    setEnabled((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }, []);

  const setCandidateQty = useCallback((swapIdx: number, cardId: string, qty: number) => {
    setCandidateQtys((prev) => ({
      ...prev,
      [swapIdx]: { ...prev[swapIdx], [cardId]: Math.max(0, qty) },
    }));
  }, []);

  const enabledCount = enabled.filter((v, i) => v && (swaps[i]?.candidates?.length ?? 0) > 0).length;

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);

    try {
      const newEntries = deckEntries.map((e) => ({ ...e }));

      for (let i = 0; i < swaps.length; i++) {
        if (!enabled[i]) continue;
        const swap = swaps[i];
        if (!swap.candidates || swap.candidates.length === 0) continue;

        // Calculate total adds from candidate selections
        const selections = candidateQtys[i] ?? {};
        const totalAdds = Object.values(selections).reduce((s, v) => s + v, 0);
        if (totalAdds === 0) continue;

        // Remove: decrement quantity by total adds
        const removeIdx = newEntries.findIndex((e) => e.card_id === swap.remove);
        if (removeIdx !== -1) {
          newEntries[removeIdx].quantity -= totalAdds;
          if (newEntries[removeIdx].quantity <= 0) {
            newEntries.splice(removeIdx, 1);
          }
        }

        // Add: each selected candidate by its quantity
        for (const [cardId, addQty] of Object.entries(selections)) {
          if (addQty <= 0) continue;
          const addIdx = newEntries.findIndex((e) => e.card_id === cardId);
          if (addIdx !== -1) {
            newEntries[addIdx].quantity += addQty;
          } else {
            newEntries.push({ card_id: cardId, quantity: addQty });
          }
        }
      }

      await updateDeck(deckId, {
        name: deckName,
        leader_id: leaderId,
        entries: newEntries,
      });

      setSuccess(true);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to apply swaps');
    } finally {
      setApplying(false);
    }
  }, [deckEntries, swaps, enabled, selectedCandidates, deckId, deckName, leaderId, onSaved]);

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Apply Card Swaps</h2>
            <p className="text-xs text-gray-400 mt-0.5">{deckName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-sm text-gray-400">Loading deck data...</span>
            </div>
          )}

          {success && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 px-6">
              <svg
                className="w-10 h-10 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm text-green-400 font-medium">Swaps applied successfully!</span>
              <p className="text-xs text-gray-400 text-center mt-1">
                Your deck has been updated. Run a new simulation to see how the changes perform, then use AI Matchup Analysis for updated insights.
              </p>
              <div className="flex gap-2 mt-2">
                {onSimulate && (
                  <button
                    onClick={() => { onClose(); onSimulate(); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-2 rounded transition-colors"
                  >
                    Run Simulation Now
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-4 py-2 rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!loading && !success && (
            <>
              <p className="px-6 pt-4 pb-2 text-xs text-gray-400">
                Select swaps and choose replacement cards:
              </p>

              {swaps.map((swap, i) => {
                const hasCandidates = (swap.candidates?.length ?? 0) > 0;
                const roleStyle = getRoleStyle(swap.role_needed);

                return (
                  <div
                    key={i}
                    className={`px-6 py-4 border-b border-gray-800 transition-colors ${
                      !hasCandidates ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Remove card row */}
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={enabled[i]}
                        onChange={() => toggleSwap(i)}
                        disabled={!hasCandidates}
                        className="mt-2 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 shrink-0"
                      />

                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {swap.remove_image ? (
                          <img
                            src={swap.remove_image}
                            alt={swap.remove_name}
                            className="w-12 h-[67px] rounded object-cover border-2 border-red-500/50 shrink-0 cursor-pointer hover:opacity-80"
                            onClick={() => setPreviewCard({ image: swap.remove_image, name: swap.remove_name })}
                          />
                        ) : (
                          <div className="w-12 h-[67px] rounded border-2 border-red-500/50 bg-gray-800 flex items-center justify-center shrink-0">
                            <span className="text-[10px] text-gray-500 text-center leading-tight px-0.5">
                              No img
                            </span>
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-red-500/70 font-mono">{swap.remove}</span>
                            <span className="text-xs text-red-400 font-medium truncate">
                              {swap.remove_name}
                            </span>
                            <span className="text-[10px] text-red-500/70">(remove)</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] text-gray-500">Role needed:</span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border} capitalize`}
                            >
                              {swap.role_needed}
                            </span>
                            {(() => {
                              const maxQty = deckEntries.find((e) => e.card_id === swap.remove)?.quantity ?? 1;
                              const qty = swapQty[i] ?? 1;
                              return maxQty > 1 ? (
                                <span className="flex items-center gap-1 ml-2">
                                  <span className="text-[10px] text-gray-500">Swap</span>
                                  <select
                                    value={qty}
                                    onChange={(e) => setSwapQty((prev) => ({ ...prev, [i]: parseInt(e.target.value, 10) }))}
                                    className="bg-gray-800 border border-gray-600 rounded px-1 py-0 text-[10px] text-white w-10"
                                    disabled={!enabled[i]}
                                  >
                                    {Array.from({ length: maxQty }, (_, k) => k + 1).map((n) => (
                                      <option key={n} value={n}>{n}</option>
                                    ))}
                                  </select>
                                  <span className="text-[10px] text-gray-500">of {maxQty} copies</span>
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 italic">
                            &ldquo;{swap.reason}&rdquo;
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Candidates selection */}
                    {hasCandidates ? (
                      <div className="mt-3 ml-7">
                        {(() => {
                          const totalSwap = swapQty[i] ?? 1;
                          const allocated = Object.values(candidateQtys[i] ?? {}).reduce((s, v) => s + v, 0);
                          const remaining = totalSwap - allocated;
                          return (
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                                Select replacement{totalSwap > 1 ? 's' : ''}:
                              </p>
                              {totalSwap > 1 && (
                                <span className={`text-[10px] font-medium ${remaining === 0 ? 'text-green-400' : 'text-amber-400'}`}>
                                  {allocated}/{totalSwap} allocated
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <div className="rounded-lg border border-gray-700 bg-gray-800/40 divide-y divide-gray-700/50">
                          {(swap.candidates ?? []).map((candidate) => {
                            const qty = candidateQtys[i]?.[candidate.card_id] ?? 0;
                            const isActive = qty > 0;
                            return (
                              <div
                                key={candidate.card_id}
                                className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                                  isActive
                                    ? 'bg-blue-900/20 border-l-2 border-l-blue-500'
                                    : 'hover:bg-gray-700/30 border-l-2 border-l-transparent'
                                }`}
                              >
                                <select
                                  value={qty}
                                  onChange={(e) => setCandidateQty(i, candidate.card_id, parseInt(e.target.value, 10))}
                                  disabled={!enabled[i]}
                                  className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white w-10 shrink-0"
                                >
                                  {Array.from({ length: (swapQty[i] ?? 1) + 1 }, (_, k) => k).map((n) => (
                                    <option key={n} value={n}>{n}x</option>
                                  ))}
                                </select>

                                {candidate.image ? (
                                  <img
                                    src={candidate.image}
                                    alt={candidate.name}
                                    className={`w-10 h-[56px] rounded object-cover shrink-0 border-2 cursor-pointer hover:opacity-80 ${
                                      isActive ? 'border-green-500/60' : 'border-gray-600/40'
                                    }`}
                                    onClick={(e) => { e.preventDefault(); setPreviewCard({ image: candidate.image, name: candidate.name }); }}
                                  />
                                ) : (
                                  <div className="w-10 h-[56px] rounded border-2 border-gray-600/40 bg-gray-800 flex items-center justify-center shrink-0">
                                    <span className="text-[9px] text-gray-500">No img</span>
                                  </div>
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 font-mono">{candidate.card_id}</span>
                                    <span className={`text-xs font-medium truncate ${isActive ? 'text-green-400' : 'text-gray-300'}`}>
                                      {candidate.name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-[10px] text-gray-500">
                                      Cost {candidate.cost ?? 0}
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                      Power {candidate.power ?? 0}
                                    </span>
                                    {(candidate.counter ?? 0) > 0 && (
                                      <span className="text-[10px] text-gray-500">
                                        Counter +{candidate.counter ?? 0}
                                      </span>
                                    )}
                                  </div>
                                  {/* Synergy bar */}
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="w-20 h-1.5 bg-gray-700 rounded-full">
                                      <div
                                        className="h-full bg-green-500 rounded-full transition-all"
                                        style={{ width: `${Math.min(candidate.synergy_score * 10, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-gray-400">
                                      {candidate.synergy_score} synergy
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 ml-7 text-[11px] text-gray-600 italic">
                        No candidates found for this swap
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !success && (
          <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between shrink-0">
            {error && <p className="text-xs text-red-400 mr-3 truncate flex-1">{error}</p>}

            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={applying || enabledCount === 0}
                className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {applying && (
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {applying
                  ? 'Applying...'
                  : `Apply ${enabledCount} Swap${enabledCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modal, document.body)}
      {previewCard && (
        <CardPreviewOverlay
          image={previewCard.image}
          name={previewCard.name}
          onClose={() => setPreviewCard(null)}
        />
      )}
    </>
  );
}
