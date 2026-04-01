import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { loadSavedDeck, searchCards, updateDeck } from '../../lib/api';
import type { CardSearchResponse } from '../../types';

interface SwapInput {
  remove: string;
  remove_id?: string;
  add: string;
  add_id?: string;
  add_image?: string;
  reason: string;
}

interface ResolvedSwap {
  remove_name: string;
  remove_id: string | null;
  remove_image: string | null;
  add_name: string;
  add_id: string | null;
  add_image: string | null;
  reason: string;
}

interface SwapConfirmModalProps {
  deckId: string;
  deckName: string;
  leaderId: string;
  swaps: SwapInput[];
  onClose: () => void;
  onSaved: () => void;
}

export default function SwapConfirmModal({
  deckId,
  deckName,
  leaderId,
  swaps,
  onClose,
  onSaved,
}: SwapConfirmModalProps) {
  const [resolving, setResolving] = useState(true);
  const [resolvedSwaps, setResolvedSwaps] = useState<ResolvedSwap[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [deckEntries, setDeckEntries] = useState<{ card_id: string; quantity: number }[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Resolve card IDs and images on mount
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const deck = await loadSavedDeck(deckId);
        if (cancelled) return;
        setDeckEntries(deck.entries);

        const resolved: ResolvedSwap[] = await Promise.all(
          swaps.map(async (swap) => {
            // Resolve remove_id: use provided or search in deck entries by name
            let removeId = swap.remove_id ?? null;
            let removeImage: string | null = null;

            if (!removeId) {
              // Search for the card by name to get its ID
              try {
                const result: CardSearchResponse = await searchCards({
                  keyword: swap.remove,
                  limit: 5,
                });
                const match = result.cards.find(
                  (c) => c.name.toLowerCase() === swap.remove.toLowerCase(),
                );
                if (match) {
                  // Verify this card is actually in the deck
                  const inDeck = deck.entries.find((e) => e.card_id === match.id);
                  if (inDeck) {
                    removeId = match.id;
                    removeImage = match.image_small;
                  }
                }
                // If exact match not found, try first result that's in the deck
                if (!removeId && result.cards.length > 0) {
                  for (const c of result.cards) {
                    if (deck.entries.find((e) => e.card_id === c.id)) {
                      removeId = c.id;
                      removeImage = c.image_small;
                      break;
                    }
                  }
                }
              } catch {
                // Search failed, leave as null
              }
            } else {
              // Have remove_id, try to get image
              try {
                const result = await searchCards({ keyword: swap.remove, limit: 1 });
                if (result.cards.length > 0) {
                  removeImage = result.cards[0].image_small;
                }
              } catch {
                // No image available
              }
            }

            // Resolve add_id and add_image
            let addId = swap.add_id ?? null;
            let addImage = swap.add_image ?? null;

            if (!addId || !addImage) {
              try {
                const result: CardSearchResponse = await searchCards({
                  keyword: swap.add,
                  limit: 5,
                });
                const match = result.cards.find(
                  (c) => c.name.toLowerCase() === swap.add.toLowerCase(),
                );
                if (match) {
                  if (!addId) addId = match.id;
                  if (!addImage) addImage = match.image_small;
                } else if (result.cards.length > 0) {
                  if (!addId) addId = result.cards[0].id;
                  if (!addImage) addImage = result.cards[0].image_small;
                }
              } catch {
                // Search failed
              }
            }

            return {
              remove_name: swap.remove,
              remove_id: removeId,
              remove_image: removeImage,
              add_name: swap.add,
              add_id: addId,
              add_image: addImage,
              reason: swap.reason,
            };
          }),
        );

        if (cancelled) return;
        setResolvedSwaps(resolved);
        setSelected(resolved.map(() => true));
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load deck data');
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [deckId, swaps]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const toggleSwap = useCallback((index: number) => {
    setSelected((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }, []);

  const selectedCount = selected.filter(Boolean).length;

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);

    try {
      // Clone current entries
      const newEntries = deckEntries.map((e) => ({ ...e }));

      for (let i = 0; i < resolvedSwaps.length; i++) {
        if (!selected[i]) continue;
        const swap = resolvedSwaps[i];

        if (!swap.remove_id || !swap.add_id) {
          continue; // Skip swaps where we couldn't resolve IDs
        }

        // Remove: decrement quantity or remove entry
        const removeIdx = newEntries.findIndex((e) => e.card_id === swap.remove_id);
        if (removeIdx !== -1) {
          if (newEntries[removeIdx].quantity > 1) {
            newEntries[removeIdx].quantity -= 1;
          } else {
            newEntries.splice(removeIdx, 1);
          }
        }

        // Add: increment quantity if exists, add new entry if not
        const addIdx = newEntries.findIndex((e) => e.card_id === swap.add_id);
        if (addIdx !== -1) {
          newEntries[addIdx].quantity += 1;
        } else {
          newEntries.push({ card_id: swap.add_id, quantity: 1 });
        }
      }

      await updateDeck(deckId, {
        name: deckName,
        leader_id: leaderId,
        entries: newEntries,
      });

      setSuccess(true);
      setTimeout(() => {
        onSaved();
      }, 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to apply swaps');
    } finally {
      setApplying(false);
    }
  }, [deckEntries, resolvedSwaps, selected, deckId, deckName, leaderId, onSaved]);

  // Count how many selected swaps have unresolved IDs
  const unresolvedCount = resolvedSwaps.filter(
    (s, i) => selected[i] && (!s.remove_id || !s.add_id),
  ).length;

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
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
          {resolving && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-sm text-gray-400">Resolving card data...</span>
            </div>
          )}

          {success && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
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
              <span className="text-sm text-green-400 font-medium">Swaps applied!</span>
            </div>
          )}

          {!resolving && !success && (
            <>
              <p className="px-6 pt-4 pb-2 text-xs text-gray-400">
                Select swaps to apply to your deck:
              </p>

              {resolvedSwaps.map((swap, i) => {
                const canApply = swap.remove_id && swap.add_id;
                return (
                  <div
                    key={i}
                    className={`px-6 py-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                      !canApply ? 'opacity-50' : ''
                    }`}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected[i]}
                        onChange={() => toggleSwap(i)}
                        disabled={!canApply}
                        className="mt-2 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 shrink-0"
                      />

                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Remove card */}
                        <div className="flex items-center gap-2 shrink-0">
                          {swap.remove_image ? (
                            <img
                              src={swap.remove_image}
                              alt={swap.remove_name}
                              className="w-12 h-[67px] rounded object-cover border-2 border-red-500/50"
                            />
                          ) : (
                            <div className="w-12 h-[67px] rounded border-2 border-red-500/50 bg-gray-800 flex items-center justify-center">
                              <span className="text-[10px] text-gray-500 text-center leading-tight px-0.5">
                                No img
                              </span>
                            </div>
                          )}
                          <span className="text-xs text-red-400 font-medium max-w-[120px] truncate">
                            {swap.remove_name}
                          </span>
                        </div>

                        {/* Arrow */}
                        <span className="text-gray-600 text-lg shrink-0">&rarr;</span>

                        {/* Add card */}
                        <div className="flex items-center gap-2 shrink-0">
                          {swap.add_image ? (
                            <img
                              src={swap.add_image}
                              alt={swap.add_name}
                              className="w-12 h-[67px] rounded object-cover border-2 border-green-500/50"
                            />
                          ) : (
                            <div className="w-12 h-[67px] rounded border-2 border-green-500/50 bg-gray-800 flex items-center justify-center">
                              <span className="text-[10px] text-gray-500 text-center leading-tight px-0.5">
                                No img
                              </span>
                            </div>
                          )}
                          <span className="text-xs text-green-400 font-medium max-w-[120px] truncate">
                            {swap.add_name}
                          </span>
                        </div>
                      </div>
                    </label>

                    {/* Reason */}
                    <p className="text-[11px] text-gray-500 mt-1.5 ml-7">
                      {`"${swap.reason}"`}
                    </p>

                    {/* Warning if unresolved */}
                    {!canApply && (
                      <p className="text-[10px] text-yellow-500 mt-1 ml-7">
                        Could not resolve card ID - swap cannot be applied
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        {!resolving && !success && (
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
                disabled={applying || selectedCount === 0 || selectedCount === unresolvedCount}
                className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {applying && (
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {applying
                  ? 'Applying...'
                  : `Apply ${selectedCount - unresolvedCount} Swap${selectedCount - unresolvedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
