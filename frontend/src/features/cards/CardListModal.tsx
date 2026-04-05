import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../../types';
import { fetchCard } from '../../lib/api';
import CardDetail from './CardDetail';
import { IconButton } from '../../components/ui';

interface Props {
  cardIds: string[];
  title: string;
  onClose: () => void;
  onAddCard?: (card: Card) => void;
  /** When provided, enables "Swap" mode — shows which card to remove when adding */
  onSwapCard?: (add: Card, removeId: string) => void;
  /** Current deck card IDs for swap target selection */
  deckCardIds?: string[];
  /** Total cards in deck — if 50, show Swap instead of Add */
  deckTotal?: number;
}

export default function CardListModal({ cardIds, title, onClose, onAddCard, onSwapCard, deckCardIds, deckTotal }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [swapTarget, setSwapTarget] = useState<Card | null>(null); // Card user wants to swap IN
  const [deckCards, setDeckCards] = useState<Card[]>([]); // Deck cards for swap picker
  const [loadingDeck, setLoadingDeck] = useState(false);
  const isDeckFull = (deckTotal ?? 0) >= 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const results: Card[] = [];
      // Fetch in parallel, batched
      const promises = cardIds.map(async (id) => {
        try {
          return await fetchCard(id) as Card;
        } catch {
          return null;
        }
      });
      const fetched = await Promise.all(promises);
      if (cancelled) return;
      for (const c of fetched) {
        if (c) results.push(c);
      }
      setCards(results);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [cardIds]);

  // Load deck cards when entering swap mode
  const handleSwapClick = async (card: Card) => {
    if (!deckCardIds || deckCardIds.length === 0) return;
    setSwapTarget(card);
    if (deckCards.length > 0) return; // Already loaded
    setLoadingDeck(true);
    const uniqueIds = [...new Set(deckCardIds)];
    const fetched = await Promise.all(uniqueIds.map(id => fetchCard(id).catch(() => null)));
    setDeckCards(fetched.filter((c): c is Card => c !== null));
    setLoadingDeck(false);
  };

  const colorBorder: Record<string, string> = {
    Red: 'border-red-500/40',
    Blue: 'border-blue-500/40',
    Green: 'border-green-500/40',
    Purple: 'border-purple-500/40',
    Yellow: 'border-yellow-500/40',
    Black: 'border-gray-500/40',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-base/80 backdrop-blur-md" />

      {/* Panel */}
      <div className="relative w-full max-w-5xl max-h-[85vh] flex flex-col glass-heavy overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <IconButton icon="close" onClick={onClose} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
              <span className="ml-3 text-text-secondary">Loading cards...</span>
            </div>
          ) : cards.length === 0 ? (
            <p className="text-center text-text-secondary py-8">No cards found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {cards.map((card) => {
                const borderColor = card.colors?.[0] ? colorBorder[card.colors[0]] || 'border-glass-border' : 'border-glass-border';
                return (
                  <div
                    key={card.id}
                    className={`group relative rounded-lg overflow-hidden border-2 ${borderColor} bg-surface-1/50 hover:scale-[1.03] transition-transform`}
                  >
                    <button
                      onClick={() => setSelectedCard(card)}
                      className="w-full cursor-pointer"
                    >
                      {card.image_small || card.image_large ? (
                        <img
                          src={card.image_small || card.image_large}
                          alt={card.name}
                          className="w-full aspect-[5/7] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full aspect-[5/7] flex items-center justify-center bg-surface-2">
                          <span className="text-xs text-text-secondary text-center px-2">{card.name}</span>
                        </div>
                      )}
                    </button>
                    {/* Card info + Add button */}
                    <div className="p-1.5 bg-surface-1/80">
                      <p className="text-[10px] text-text-primary truncate font-medium">{card.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[9px] text-text-muted">{card.id}</span>
                        {isDeckFull && onSwapCard && deckCardIds ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwapClick(card);
                            }}
                            disabled={addedIds.has(card.id)}
                            className={`text-[9px] font-medium px-2 py-0.5 rounded transition-colors ${
                              addedIds.has(card.id)
                                ? 'bg-green-900/40 text-green-400'
                                : 'bg-amber-600/80 text-white hover:bg-amber-500'
                            }`}
                          >
                            {addedIds.has(card.id) ? 'Swapped' : 'Swap'}
                          </button>
                        ) : onAddCard ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddCard(card);
                              setAddedIds(prev => new Set(prev).add(card.id));
                            }}
                            disabled={addedIds.has(card.id)}
                            className={`text-[9px] font-medium px-2 py-0.5 rounded transition-colors ${
                              addedIds.has(card.id)
                                ? 'bg-green-900/40 text-green-400'
                                : 'bg-blue-600/80 text-white hover:bg-blue-500'
                            }`}
                          >
                            {addedIds.has(card.id) ? 'Added' : '+ Deck'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Card detail overlay */}
      {selectedCard && (
        <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />
      )}

      {/* Swap picker: choose which card to remove */}
      {swapTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSwapTarget(null); }}
        >
          <div className="absolute inset-0 bg-surface-base/85 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl max-h-[70vh] flex flex-col glass-heavy overflow-hidden animate-fade-up">
            <div className="flex items-center justify-between px-5 py-3 border-b border-glass-border shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Swap: Add {swapTarget.name}
                </h3>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  Select a card to remove from your deck:
                </p>
              </div>
              <IconButton icon="close" onClick={() => setSwapTarget(null)} />
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingDeck ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-blue" />
                  <span className="ml-2 text-sm text-text-secondary">Loading deck...</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {deckCards.map((dc) => (
                    <button
                      key={dc.id}
                      onClick={() => {
                        if (onSwapCard) {
                          onSwapCard(swapTarget, dc.id);
                          setAddedIds(prev => new Set(prev).add(swapTarget.id));
                          setSwapTarget(null);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-950/30 border border-transparent hover:border-red-500/30 transition-colors text-left"
                    >
                      {dc.image_small ? (
                        <img src={dc.image_small} alt={dc.name} className="w-8 h-11 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-11 rounded bg-surface-2 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary truncate">{dc.name}</p>
                        <p className="text-[10px] text-text-muted">{dc.id} · Cost {dc.cost ?? 0} · {dc.card_type}</p>
                      </div>
                      <span className="text-[10px] text-red-400 font-medium shrink-0">Remove</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
