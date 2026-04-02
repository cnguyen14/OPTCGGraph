import { useState, useEffect } from 'react';
import type { SavedDeck, SavedDeckListItem } from '../../types';
import { listSavedDecks, loadSavedDeck, deleteSavedDeck } from '../../lib/api';
import { Modal, Button, Spinner } from '../../components/ui';

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
    <Modal open={open} onClose={onClose} title="My Decks" size="md">
      {error && (
        <div className="mb-3 p-2 rounded bg-red-950/30 border border-red-700/40 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}

      {!loading && decks.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">No saved decks yet</p>
          <p className="text-xs text-text-muted mt-1">Build a deck and save it to see it here</p>
        </div>
      )}

      {!loading && decks.length > 0 && (
        <div className="space-y-2">
          {decks.map((deck) => (
            <div
              key={deck.id}
              className="flex items-center gap-3 bg-surface-2 rounded-lg p-3 hover:bg-surface-3 transition-colors group"
            >
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{deck.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {deck.leader_id && (
                    <span className="text-[10px] text-text-muted font-mono">{deck.leader_id}</span>
                  )}
                  <span className="text-[10px] text-text-muted">
                    {deck.card_count}/50 cards
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {formatDate(deck.updated_at)}
                  </span>
                </div>
                {deck.description && (
                  <p className="text-[11px] text-text-secondary mt-1 truncate">{deck.description}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleLoad(deck.id)}
                  disabled={loadingDeckId === deck.id}
                  className="text-[11px]"
                >
                  {loadingDeckId === deck.id ? (
                    <Spinner size="sm" />
                  ) : (
                    'Load'
                  )}
                </Button>
                {confirmDelete === deck.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(deck.id)}
                      className="text-[11px]"
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(null)}
                      className="text-[11px]"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(deck.id)}
                    className="text-[11px] text-text-muted hover:text-red-400"
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
