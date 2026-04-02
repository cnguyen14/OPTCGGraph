import { useState, useEffect, useRef } from 'react';
import { listSavedDecks, loadSavedDeck, deleteSavedDeck, searchCards } from '../../lib/api';
import type { SavedDeckListItem } from '../../types';
import DeckDetailPanel from './DeckDetailPanel';
import { GlassCard, Button, Input, Select, Spinner } from '../../components/ui';

interface Props {
  onLoadDeck: (leaderId: string, cardIds: string[]) => void;
  onSimulateDeck: (leaderId: string, cardIds: string[]) => void;
  onNewDeck: () => void;
}

export default function MyDecksPage({ onLoadDeck, onSimulateDeck, onNewDeck }: Props) {
  const [decks, setDecks] = useState<SavedDeckListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [leaderImages, setLeaderImages] = useState<Record<string, string>>({});
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [expandedCardIds, setExpandedCardIds] = useState<string[]>([]);
  const [detailKey, setDetailKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const reloadExpandedDeck = async (deckId: string) => {
    try {
      const full = await loadSavedDeck(deckId);
      const cardIds: string[] = [];
      for (const entry of full.entries) {
        for (let i = 0; i < entry.quantity; i++) {
          cardIds.push(entry.card_id);
        }
      }
      setExpandedCardIds(cardIds);
      setDetailKey((k) => k + 1);
    } catch {
      // ignore
    }
  };

  const fetchDecks = () => {
    setLoading(true);
    listSavedDecks()
      .then(setDecks)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDecks();
  }, []);

  // Fetch leader card images
  useEffect(() => {
    const leaderIds = [...new Set(decks.map((d) => d.leader_id).filter(Boolean))] as string[];
    const missing = leaderIds.filter((id) => !leaderImages[id]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map((id) =>
        searchCards({ keyword: id, card_type: 'LEADER', limit: 1 })
          .then((res) => ({ id, image: res.cards[0]?.image_small ?? '' }))
          .catch(() => ({ id, image: '' })),
      ),
    ).then((results) => {
      setLeaderImages((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.image) next[r.id] = r.image;
        }
        return next;
      });
    });
  }, [decks]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteSavedDeck(id);
      setDecks((prev) => prev.filter((d) => d.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete deck:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoad = async (deck: SavedDeckListItem) => {
    if (!deck.leader_id) return;
    setActionLoading(deck.id);
    try {
      const full = await loadSavedDeck(deck.id);
      const cardIds: string[] = [];
      for (const entry of full.entries) {
        for (let i = 0; i < entry.quantity; i++) {
          cardIds.push(entry.card_id);
        }
      }
      onLoadDeck(full.leader_id ?? '', cardIds);
    } catch (err) {
      console.error('Failed to load deck:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSimulate = async (deck: SavedDeckListItem) => {
    if (!deck.leader_id || deck.card_count !== 50) return;
    setActionLoading(deck.id);
    try {
      const full = await loadSavedDeck(deck.id);
      const cardIds: string[] = [];
      for (const entry of full.entries) {
        for (let i = 0; i < entry.quantity; i++) {
          cardIds.push(entry.card_id);
        }
      }
      onSimulateDeck(full.leader_id ?? '', cardIds);
    } catch (err) {
      console.error('Failed to load deck for simulation:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSelectDeck = async (deck: SavedDeckListItem) => {
    if (selectedDeckId === deck.id) {
      setSelectedDeckId(null);
      setExpandedCardIds([]);
      return;
    }
    setSelectedDeckId(deck.id);
    try {
      const full = await loadSavedDeck(deck.id);
      const cardIds: string[] = [];
      for (const entry of full.entries) {
        for (let i = 0; i < entry.quantity; i++) {
          cardIds.push(entry.card_id);
        }
      }
      setExpandedCardIds(cardIds);
      // Scroll to panel after a brief delay for rendering
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    } catch (err) {
      console.error('Failed to load deck for detail panel:', err);
      setExpandedCardIds([]);
    }
  };

  const filtered = decks
    .filter(
      (d) =>
        d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (d.description ?? '').toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-text-primary">My Decks</h2>
            <p className="text-sm text-text-secondary mt-1">
              Manage your saved decks. Load them into the builder or test them in the simulator.
            </p>
          </div>
          <Button onClick={onNewDeck} variant="primary">
            + New Deck
          </Button>
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-3">
          <Input
            type="text"
            placeholder="Search decks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}
          >
            <option value="recent">Most Recent</option>
            <option value="name">Name A-Z</option>
          </Select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Spinner size="md" />
            <span className="text-sm text-text-secondary">Loading decks...</span>
          </div>
        )}

        {/* Deck list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((deck) => (
              <div key={deck.id} className="space-y-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectDeck(deck)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectDeck(deck);
                    }
                  }}
                  className={`glass-subtle p-4 transition-colors cursor-pointer glass-hover ${
                    selectedDeckId === deck.id
                      ? 'border-op-ocean/50 ring-1 ring-op-ocean/20'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Leader card image */}
                    {deck.leader_id && leaderImages[deck.leader_id] ? (
                      <img
                        src={leaderImages[deck.leader_id]}
                        alt="Leader"
                        className="w-16 h-[88px] object-cover rounded-lg shrink-0 border border-gray-700/50"
                      />
                    ) : (
                      <div className="w-16 h-[88px] bg-gray-800 rounded-lg shrink-0 border border-gray-700/50 flex items-center justify-center">
                        <span className="text-[10px] text-gray-500 text-center px-1">{deck.leader_id ?? 'No leader'}</span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary truncate">{deck.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                        {deck.leader_id && (
                          <span className="truncate max-w-[180px]">Leader: {deck.leader_id}</span>
                        )}
                        <span className={deck.card_count === 50 ? 'text-green-400' : 'text-yellow-400'}>
                          {deck.card_count} cards
                        </span>
                        <span>Updated: {formatDate(deck.updated_at)}</span>
                      </div>
                      {deck.description && (
                        <p className="text-xs text-text-muted mt-1.5 line-clamp-2">{deck.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        onClick={() => handleLoad(deck)}
                        disabled={!deck.leader_id || actionLoading === deck.id}
                        variant="secondary"
                        size="sm"
                      >
                        {actionLoading === deck.id ? '...' : 'Load'}
                      </Button>
                      <Button
                        onClick={() => handleSimulate(deck)}
                        disabled={!deck.leader_id || deck.card_count !== 50 || actionLoading === deck.id}
                        variant="primary"
                        size="sm"
                        title={deck.card_count !== 50 ? 'Deck must have exactly 50 cards' : ''}
                      >
                        Simulate
                      </Button>
                      {confirmDeleteId === deck.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            onClick={() => handleDelete(deck.id)}
                            disabled={deletingId === deck.id}
                            variant="danger"
                            size="sm"
                          >
                            {deletingId === deck.id ? '...' : 'Confirm'}
                          </Button>
                          <Button
                            onClick={() => setConfirmDeleteId(null)}
                            variant="ghost"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setConfirmDeleteId(deck.id)}
                          variant="ghost"
                          size="sm"
                          className="text-text-muted hover:text-red-400"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expandable detail panel */}
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    selectedDeckId === deck.id ? 'max-h-[2000px] opacity-100 mt-2' : 'max-h-0 opacity-0'
                  }`}
                >
                  {selectedDeckId === deck.id && deck.leader_id && expandedCardIds.length > 0 && (
                    <div ref={panelRef}>
                      <DeckDetailPanel
                        key={detailKey}
                        deckId={deck.id}
                        leaderId={deck.leader_id}
                        cardIds={expandedCardIds}
                        deckName={deck.name}
                        onClose={() => {
                          setSelectedDeckId(null);
                          setExpandedCardIds([]);
                        }}
                        onOpenBuilder={() => handleLoad(deck)}
                        onSimulate={() => handleSimulate(deck)}
                        onDeckChanged={() => reloadExpandedDeck(deck.id)}
                      />
                    </div>
                  )}
                  {selectedDeckId === deck.id && (!deck.leader_id || expandedCardIds.length === 0) && (
                    <GlassCard className="p-6 text-center">
                      {!deck.leader_id ? (
                        <p className="text-sm text-text-muted">
                          This deck has no leader. Set a leader in the Deck Builder to see analysis.
                        </p>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <Spinner size="sm" />
                          <span className="text-sm text-text-secondary">Loading deck data...</span>
                        </div>
                      )}
                    </GlassCard>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && decks.length === 0 && (
          <GlassCard className="text-center py-16">
            <div className="text-4xl mb-3 opacity-30">&#x1F0CF;</div>
            <h3 className="text-sm font-medium text-text-secondary mb-1">No saved decks yet</h3>
            <p className="text-xs text-text-muted mb-4">
              Head to the Deck Builder to create and save your first deck.
            </p>
            <Button onClick={onNewDeck} variant="primary">
              Go to Deck Builder
            </Button>
          </GlassCard>
        )}

        {/* No search results */}
        {!loading && decks.length > 0 && filtered.length === 0 && (
          <p className="text-center text-sm text-text-muted py-8">
            No decks matching &quot;{searchTerm}&quot;
          </p>
        )}
      </div>
    </div>
  );
}
