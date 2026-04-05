import { useState, useEffect } from 'react';
import { listSavedDecks, loadSavedDeck, deleteSavedDeck, searchCards } from '../../lib/api';
import type { SavedDeckListItem } from '../../types';
import DeckDetailPanel from './DeckDetailPanel';
import { Button, Input, Select, Spinner } from '../../components/ui';

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
      if (selectedDeckId === id) {
        setSelectedDeckId(null);
        setExpandedCardIds([]);
      }
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;

  return (
    <div className="h-full flex gap-3 p-3 overflow-hidden">
      {/* ── Left Sidebar: Deck List ── */}
      <div className="glass w-72 shrink-0 overflow-y-auto p-4 space-y-3 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">My Decks</h2>
          <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">
            {decks.length}
          </span>
        </div>

        {/* Search & Sort */}
        <Input
          type="text"
          placeholder="Search decks..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}
        >
          <option value="recent">Most Recent</option>
          <option value="name">Name A-Z</option>
        </Select>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Spinner size="sm" />
            <span className="text-xs text-text-secondary">Loading...</span>
          </div>
        )}

        {/* Deck cards */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-2 flex-1 min-h-0">
            {filtered.map((deck) => (
              <div
                key={deck.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectDeck(deck)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectDeck(deck);
                  }
                }}
                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                  selectedDeckId === deck.id
                    ? 'bg-op-ocean/10 border border-op-ocean/50 ring-1 ring-op-ocean/20'
                    : 'hover:bg-surface-2/50 border border-transparent'
                }`}
              >
                {/* Leader thumbnail */}
                {deck.leader_id && leaderImages[deck.leader_id] ? (
                  <img
                    src={leaderImages[deck.leader_id]}
                    alt="Leader"
                    className="w-10 h-14 object-cover rounded shrink-0 border border-gray-700/50"
                  />
                ) : (
                  <div className="w-10 h-14 bg-gray-800 rounded shrink-0 border border-gray-700/50 flex items-center justify-center">
                    <span className="text-[8px] text-gray-500 text-center leading-tight">
                      {deck.leader_id ? deck.leader_id.slice(-6) : 'N/A'}
                    </span>
                  </div>
                )}

                {/* Deck info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-text-primary truncate">{deck.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-xs font-medium ${
                        deck.card_count === 50 ? 'text-green-400' : 'text-yellow-400'
                      }`}
                    >
                      {deck.card_count}
                    </span>
                    <span className="text-[10px] text-text-muted">{formatDate(deck.updated_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && decks.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <p className="text-xs text-text-muted mb-3">No saved decks yet</p>
            <Button onClick={onNewDeck} variant="primary" size="sm">
              Go to Deck Builder
            </Button>
          </div>
        )}

        {/* No search results */}
        {!loading && decks.length > 0 && filtered.length === 0 && (
          <p className="text-center text-xs text-text-muted py-4">
            No decks matching &quot;{searchTerm}&quot;
          </p>
        )}

        {/* New Deck button pinned to bottom */}
        <div className="mt-auto pt-3 border-t border-glass-border">
          <Button onClick={onNewDeck} variant="primary" className="w-full">
            + New Deck
          </Button>
        </div>
      </div>

      {/* ── Right Panel: Deck Detail ── */}
      <div className="flex-1 glass overflow-hidden min-w-0 flex flex-col">
        {selectedDeck && selectedDeck.leader_id && expandedCardIds.length > 0 ? (
          <DeckDetailPanel
            key={detailKey}
            deckId={selectedDeck.id}
            leaderId={selectedDeck.leader_id}
            cardIds={expandedCardIds}
            deckName={selectedDeck.name}
            onClose={() => {
              setSelectedDeckId(null);
              setExpandedCardIds([]);
            }}
            onOpenBuilder={() => handleLoad(selectedDeck)}
            onSimulate={() => handleSimulate(selectedDeck)}
            onDelete={() => {
              if (confirmDeleteId === selectedDeck.id) {
                handleDelete(selectedDeck.id);
                setConfirmDeleteId(null);
              } else {
                setConfirmDeleteId(selectedDeck.id);
              }
            }}
            onDeckChanged={() => reloadExpandedDeck(selectedDeck.id)}
            isConfirmingDelete={confirmDeleteId === selectedDeck.id}
            isDeletingDeck={deletingId === selectedDeck.id}
            onCancelDelete={() => setConfirmDeleteId(null)}
            isActionLoading={actionLoading === selectedDeck.id}
          />
        ) : selectedDeck && (!selectedDeck.leader_id || expandedCardIds.length === 0) ? (
          <div className="flex-1 flex items-center justify-center">
            {!selectedDeck.leader_id ? (
              <p className="text-sm text-text-muted">
                This deck has no leader. Set a leader in the Deck Builder to see analysis.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-sm text-text-secondary">Loading deck data...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-sm text-text-muted">Select a deck to view details</p>
              <p className="text-xs text-text-muted/60">
                Click on a deck from the sidebar to see its analysis, history, and more.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
