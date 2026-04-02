import { useState, useEffect, useCallback } from 'react';
import type { DeckStateReturn } from '../../hooks/useDeckState';
import type { Card, MetaDeckSummary, MetaDeckDetail, MetaDeckCard, MetaOverview, SwapSuggestion } from '../../types';
import {
  fetchMetaOverview,
  fetchMetaDecks,
  fetchMetaDeckDetail,
  fetchCard,
  fetchDeckSynergies,
  suggestSwap,
} from '../../lib/api';
import type { MetaDeckFilters } from '../../lib/api';
import DeckMap from '../deck-builder/DeckMap';
import type { DeckEntry } from '../../types';
import { Button, Spinner } from '../../components/ui';

const PLACEMENT_MEDALS: Record<number, string> = {
  1: '\u{1F947}',
  2: '\u{1F948}',
  3: '\u{1F949}',
};

interface Props {
  onCardSelect: (card: Card) => void;
  deckState: DeckStateReturn;
}

type ViewMode = 'list' | 'map';

export default function MetaExplorer({ onCardSelect, deckState }: Props) {
  const [overview, setOverview] = useState<MetaOverview | null>(null);
  const [decks, setDecks] = useState<MetaDeckSummary[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<MetaDeckDetail | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(false);
  const [deckLoading, setDeckLoading] = useState(false);
  const [filters, setFilters] = useState<MetaDeckFilters>({ limit: 50 });
  const [swapInfo, setSwapInfo] = useState<{ suggestion: SwapSuggestion; incomingCard: MetaDeckCard } | null>(null);

  // Load overview on mount
  useEffect(() => {
    fetchMetaOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  // Load decks when filters change
  useEffect(() => {
    setLoading(true);
    fetchMetaDecks(filters)
      .then((data) => {
        setDecks(data);
        setLoading(false);
      })
      .catch(() => {
        setDecks([]);
        setLoading(false);
      });
  }, [filters]);

  const handleDeckClick = useCallback((deckId: string) => {
    setDeckLoading(true);
    setSwapInfo(null);
    fetchMetaDeckDetail(deckId)
      .then((detail) => {
        setSelectedDeck(detail);
        setDeckLoading(false);
      })
      .catch(() => {
        setSelectedDeck(null);
        setDeckLoading(false);
      });
  }, []);

  const handleAddCard = useCallback(async (metaCard: MetaDeckCard) => {
    // Build full Card from meta card + fetch
    try {
      const card = await fetchCard(metaCard.id);
      if (deckState.totalCards >= 50) {
        // Deck full — suggest swap
        const deckCardIds: string[] = [];
        deckState.entries.forEach((entry) => {
          for (let i = 0; i < entry.quantity; i++) {
            deckCardIds.push(entry.card.id);
          }
        });
        const suggestion = await suggestSwap(deckCardIds, metaCard.id, deckState.leader?.id);
        if (suggestion) {
          setSwapInfo({ suggestion, incomingCard: metaCard });
        }
      } else {
        deckState.addCard(card);
      }
    } catch {
      // Card fetch failed
    }
  }, [deckState]);

  const handleConfirmSwap = useCallback(async () => {
    if (!swapInfo) return;
    try {
      const addCard = await fetchCard(swapInfo.suggestion.add_id);
      deckState.bulkReplace([swapInfo.suggestion.remove_id], [addCard]);
      setSwapInfo(null);
    } catch {
      // ignore
    }
  }, [swapInfo, deckState]);

  const handleCopyFullDeck = useCallback(async () => {
    if (!selectedDeck) return;
    const cardIds: string[] = [];
    for (const c of selectedDeck.cards) {
      for (let i = 0; i < c.count; i++) {
        cardIds.push(c.id);
      }
    }
    await deckState.loadDeckFromIds(selectedDeck.leader_id, cardIds);
  }, [selectedDeck, deckState]);

  // Build DeckMap entries from selected tournament deck
  const mapEntries = new Map<string, DeckEntry>();
  const [mapLeader, setMapLeader] = useState<Card | null>(null);

  useEffect(() => {
    if (viewMode === 'map' && selectedDeck?.leader_id) {
      fetchCard(selectedDeck.leader_id)
        .then(setMapLeader)
        .catch(() => setMapLeader(null));
    }
  }, [viewMode, selectedDeck?.leader_id]);

  if (selectedDeck && viewMode === 'map') {
    for (const mc of selectedDeck.cards) {
      mapEntries.set(mc.id, {
        card: {
          id: mc.id,
          code: '',
          name: mc.name,
          card_type: mc.card_type,
          cost: mc.cost,
          power: mc.power,
          counter: mc.counter,
          rarity: '',
          attribute: '',
          color: '',
          ability: '',
          trigger_effect: '',
          image_small: mc.image_small,
          image_large: '',
          inventory_price: null,
          market_price: null,
          life: '',
          colors: [],
          families: [],
          set_name: '',
          keywords: mc.keywords,
        },
        quantity: mc.count,
      });
    }
  }

  // Group cards by type for list view
  const groupedCards: Record<string, MetaDeckCard[]> = {};
  if (selectedDeck) {
    for (const card of selectedDeck.cards) {
      const type = card.card_type || 'Other';
      if (!groupedCards[type]) groupedCards[type] = [];
      groupedCards[type].push(card);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar: overview stats + filters */}
      <div className="shrink-0 bg-surface-base border-b border-glass-border px-4 py-2 flex items-center gap-4">
        {overview && (
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span>{overview.total_tournaments} tournaments</span>
            <span className="text-text-muted">|</span>
            <span>{overview.total_decks} decks</span>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* Archetype filter */}
          <input
            type="text"
            placeholder="Filter archetype..."
            className="bg-surface-1 border border-glass-border rounded px-2 py-1 text-xs text-text-primary w-40 focus:outline-none focus:border-op-ocean placeholder:text-text-muted"
            onChange={(e) => setFilters((prev) => ({ ...prev, archetype: e.target.value || undefined }))}
          />
          {/* Placement filter */}
          <select
            className="bg-surface-1 border border-glass-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-op-ocean"
            onChange={(e) => setFilters((prev) => ({ ...prev, max_placement: e.target.value ? Number(e.target.value) : undefined }))}
          >
            <option value="">All placements</option>
            <option value="1">Top 1</option>
            <option value="4">Top 4</option>
            <option value="8">Top 8</option>
            <option value="16">Top 16</option>
            <option value="32">Top 32</option>
          </select>
          {/* Leader filter from overview */}
          {overview && overview.top_leaders.length > 0 && (
            <select
              className="bg-surface-1 border border-glass-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-op-ocean"
              onChange={(e) => setFilters((prev) => ({ ...prev, leader: e.target.value || undefined }))}
            >
              <option value="">All leaders</option>
              {overview.top_leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.deck_count})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — Deck list */}
        <div className="w-80 shrink-0 border-r border-glass-border overflow-y-auto bg-surface-base">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Spinner size="md" />
            </div>
          ) : decks.length === 0 ? (
            <div className="text-center text-text-muted text-sm py-8">
              No tournament decks found.
              <br />
              <span className="text-xs">Run the crawler to load data.</span>
            </div>
          ) : (
            <div className="divide-y divide-glass-border/50">
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  onClick={() => handleDeckClick(deck.id)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-surface-2 transition-colors ${
                    selectedDeck?.id === deck.id ? 'bg-surface-2 border-l-2 border-op-ocean' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm shrink-0 w-6 text-center">
                      {deck.placement && PLACEMENT_MEDALS[deck.placement]
                        ? PLACEMENT_MEDALS[deck.placement]
                        : deck.placement
                          ? `#${deck.placement}`
                          : '-'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary text-sm font-medium truncate">
                        {deck.archetype || deck.leader_name || 'Unknown'}
                      </p>
                      <p className="text-text-muted text-xs truncate">
                        {deck.player_name}
                      </p>
                      {deck.tournament && (
                        <p className="text-text-muted text-[10px] truncate mt-0.5">
                          {deck.tournament.name} ({deck.tournament.player_count}p)
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel — Deck detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedDeck ? (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <p className="text-lg">Select a deck</p>
                <p className="text-sm mt-1">Click on a tournament deck to view details</p>
              </div>
            </div>
          ) : deckLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="shrink-0 glass-subtle border-b border-glass-border px-4 py-3">
                <div className="flex items-center gap-3">
                  {selectedDeck.leader_image && (
                    <img
                      src={selectedDeck.leader_image}
                      alt=""
                      className="w-12 h-[68px] rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary font-semibold">
                      {selectedDeck.archetype || selectedDeck.leader_name}
                    </p>
                    <p className="text-text-secondary text-sm">
                      {selectedDeck.player_name}
                      {selectedDeck.placement && ` — #${selectedDeck.placement}`}
                      {selectedDeck.tournament && ` at ${selectedDeck.tournament.name}`}
                    </p>
                    <div className="flex gap-2 mt-1 text-xs text-text-muted">
                      <span>{selectedDeck.total_cards} cards</span>
                      {Object.entries(selectedDeck.type_distribution).map(([type, count]) => (
                        <span key={type}>
                          {type}: {count}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* View toggle */}
                    <div className="flex bg-surface-2 rounded overflow-hidden">
                      <button
                        onClick={() => setViewMode('list')}
                        className={`px-3 py-1 text-xs ${viewMode === 'list' ? 'bg-op-ocean text-white' : 'text-text-muted hover:text-text-primary'}`}
                      >
                        List
                      </button>
                      <button
                        onClick={() => setViewMode('map')}
                        className={`px-3 py-1 text-xs ${viewMode === 'map' ? 'bg-op-ocean text-white' : 'text-text-muted hover:text-text-primary'}`}
                      >
                        Map
                      </button>
                    </div>
                    <Button onClick={handleCopyFullDeck} variant="primary" size="sm">
                      Copy Full Deck
                    </Button>
                  </div>
                </div>
              </div>

              {/* Swap recommendation banner */}
              {swapInfo && (
                <div className="shrink-0 glass-subtle border-b border-yellow-700/50 px-4 py-2 flex items-center gap-3">
                  <span className="text-yellow-400 text-xs flex-1">
                    Deck full! Swap <span className="font-semibold text-red-400">{swapInfo.suggestion.remove_name}</span> for{' '}
                    <span className="font-semibold text-green-400">{swapInfo.suggestion.add_name}</span>?{' '}
                    <span className="text-yellow-500/80">{swapInfo.suggestion.reason}</span>
                  </span>
                  <Button onClick={handleConfirmSwap} variant="success" size="sm">
                    Confirm
                  </Button>
                  <Button onClick={() => setSwapInfo(null)} variant="ghost" size="sm">
                    Cancel
                  </Button>
                </div>
              )}

              {/* Content area */}
              {viewMode === 'list' ? (
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {Object.entries(groupedCards).map(([type, cards]) => (
                    <div key={type} className="mb-4">
                      <h3 className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
                        {type} ({cards.reduce((s, c) => s + c.count, 0)})
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                        {cards.map((card) => (
                          <div
                            key={card.id}
                            className="flex items-center gap-2 glass-subtle p-2 glass-hover transition-colors group"
                          >
                            {card.image_small && (
                              <img
                                src={card.image_small}
                                alt=""
                                className="w-10 h-14 rounded object-cover shrink-0 cursor-pointer"
                                onClick={() => onCardSelect({
                                  id: card.id, code: '', name: card.name, card_type: card.card_type,
                                  cost: card.cost, power: card.power, counter: card.counter,
                                  rarity: '', attribute: '', color: '', ability: '', trigger_effect: '',
                                  image_small: card.image_small, image_large: '', inventory_price: null,
                                  market_price: null, life: '', colors: [], families: [], set_name: '',
                                  keywords: card.keywords,
                                })}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-text-primary text-xs font-medium truncate">{card.name}</p>
                              <div className="flex gap-1 mt-0.5">
                                {card.cost !== null && (
                                  <span className="text-[10px] bg-blue-900/50 text-blue-300 rounded px-1">{card.cost}</span>
                                )}
                                {card.power !== null && (
                                  <span className="text-[10px] bg-red-900/50 text-red-300 rounded px-1">{card.power}</span>
                                )}
                                <span className="text-[10px] bg-gray-700 text-gray-300 rounded px-1">x{card.count}</span>
                              </div>
                              {card.keywords.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                  {card.keywords.map((kw) => (
                                    <span key={kw} className="text-[9px] text-purple-400">{kw}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => handleAddCard(card)}
                              className="opacity-0 group-hover:opacity-100 bg-green-600/80 hover:bg-green-500 text-white text-[10px] px-2 py-1 rounded transition-opacity shrink-0"
                            >
                              + Add
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <DeckMap
                  leader={mapLeader}
                  entries={mapEntries}
                  onCardSelect={onCardSelect}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
