import { useState, useEffect } from 'react';
import type { SavedDeck, SavedDeckListItem } from '../../types';
import { listSavedDecks, loadSavedDeck, deleteSavedDeck } from '../../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onLoadDeck: (deck: SavedDeck) => void;
}

export default function DeckLibrary({ open, onClose, onLoadDeck }: Props) {
  const [decks, setDecks] = useState<SavedDeckListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDeckId, setLoadingDeckId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listSavedDecks()
      .then(setDecks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load decks'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const handleLoad = async (deckId: string) => {
    setLoadingDeckId(deckId);
    try {
      const deck = await loadSavedDeck(deckId);
      onLoadDeck(deck);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deck');
    } finally {
      setLoadingDeckId(null);
    }
  };

  const handleDelete = async (deckId: string) => {
    try {
      await deleteSavedDeck(deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deck');
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[520px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="text-white font-semibold text-sm">My Decks</h3>
            <span className="text-[10px] text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
              {decks.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && (
            <div className="mb-3 p-2 rounded bg-red-950/30 border border-red-700/40 text-xs text-red-400">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {!loading && decks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">No saved decks yet</p>
              <p className="text-xs text-gray-600 mt-1">Build a deck and save it to see it here</p>
            </div>
          )}

          {!loading && decks.length > 0 && (
            <div className="space-y-2">
              {decks.map((deck) => (
                <div
                  key={deck.id}
                  className="flex items-center gap-3 bg-gray-800/40 rounded-lg p-3 hover:bg-gray-800/70 transition-colors group"
                >
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{deck.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {deck.leader_id && (
                        <span className="text-[10px] text-gray-500 font-mono">{deck.leader_id}</span>
                      )}
                      <span className="text-[10px] text-gray-500">
                        {deck.card_count}/50 cards
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {formatDate(deck.updated_at)}
                      </span>
                    </div>
                    {deck.description && (
                      <p className="text-[11px] text-gray-400 mt-1 truncate">{deck.description}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleLoad(deck.id)}
                      disabled={loadingDeckId === deck.id}
                      className="px-3 py-1.5 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {loadingDeckId === deck.id ? (
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        'Load'
                      )}
                    </button>
                    {confirmDelete === deck.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(deck.id)}
                          className="px-2 py-1.5 text-[11px] font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(deck.id)}
                        className="px-2 py-1.5 text-[11px] text-gray-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
