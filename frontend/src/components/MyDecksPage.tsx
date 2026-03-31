import { useState, useEffect } from 'react';
import { listSavedDecks, loadSavedDeck, deleteSavedDeck, searchCards } from '../lib/api';
import type { SavedDeckListItem } from '../types';

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
            <h2 className="text-xl font-bold text-white">My Decks</h2>
            <p className="text-sm text-gray-400 mt-1">
              Manage your saved decks. Load them into the builder or test them in the simulator.
            </p>
          </div>
          <button
            onClick={onNewDeck}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Deck
          </button>
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search decks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600/50"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="recent">Most Recent</option>
            <option value="name">Name A-Z</option>
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-gray-400">Loading decks...</span>
          </div>
        )}

        {/* Deck list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((deck) => (
              <div
                key={deck.id}
                className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 hover:border-gray-600/50 transition-colors"
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
                    <h3 className="text-sm font-semibold text-white truncate">{deck.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      {deck.leader_id && (
                        <span className="truncate max-w-[180px]">Leader: {deck.leader_id}</span>
                      )}
                      <span className={deck.card_count === 50 ? 'text-green-400' : 'text-yellow-400'}>
                        {deck.card_count} cards
                      </span>
                      <span>Updated: {formatDate(deck.updated_at)}</span>
                    </div>
                    {deck.description && (
                      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{deck.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleLoad(deck)}
                      disabled={!deck.leader_id || actionLoading === deck.id}
                      className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors disabled:opacity-40"
                    >
                      {actionLoading === deck.id ? '...' : 'Load'}
                    </button>
                    <button
                      onClick={() => handleSimulate(deck)}
                      disabled={!deck.leader_id || deck.card_count !== 50 || actionLoading === deck.id}
                      className="px-3 py-1.5 text-xs bg-blue-900/40 hover:bg-blue-800/50 text-blue-400 hover:text-blue-300 rounded-lg transition-colors disabled:opacity-40"
                      title={deck.card_count !== 50 ? 'Deck must have exactly 50 cards' : ''}
                    >
                      Simulate
                    </button>
                    {confirmDeleteId === deck.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(deck.id)}
                          disabled={deletingId === deck.id}
                          className="px-2 py-1.5 text-xs bg-red-900/40 hover:bg-red-800/50 text-red-400 rounded-lg transition-colors"
                        >
                          {deletingId === deck.id ? '...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(deck.id)}
                        className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-400 rounded-lg transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && decks.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-30">&#x1F0CF;</div>
            <h3 className="text-sm font-medium text-gray-400 mb-1">No saved decks yet</h3>
            <p className="text-xs text-gray-500 mb-4">
              Head to the Deck Builder to create and save your first deck.
            </p>
            <button
              onClick={onNewDeck}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Go to Deck Builder
            </button>
          </div>
        )}

        {/* No search results */}
        {!loading && decks.length > 0 && filtered.length === 0 && (
          <p className="text-center text-sm text-gray-500 py-8">
            No decks matching &quot;{searchTerm}&quot;
          </p>
        )}
      </div>
    </div>
  );
}
