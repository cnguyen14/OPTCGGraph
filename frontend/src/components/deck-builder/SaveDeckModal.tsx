import { useState } from 'react';
import type { Card, DeckEntry, SavedDeck } from '../../types';
import { saveDeck, updateDeck } from '../../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (deck: SavedDeck) => void;
  leader: Card | null;
  entries: Map<string, DeckEntry>;
  deckNotes: string;
  existingDeckId?: string | null;
  existingName?: string | null;
  existingDescription?: string | null;
}

export default function SaveDeckModal({
  open,
  onClose,
  onSaved,
  leader,
  entries,
  deckNotes,
  existingDeckId,
  existingName,
  existingDescription,
}: Props) {
  const [name, setName] = useState(existingName || '');
  const [description, setDescription] = useState(existingDescription || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const totalCards = Array.from(entries.values()).reduce((s, e) => s + e.quantity, 0);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a deck name');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        leader_id: leader?.id ?? null,
        entries: Array.from(entries.entries()).map(([cardId, e]) => ({
          card_id: cardId,
          quantity: e.quantity,
        })),
        deck_notes: deckNotes,
      };

      const saved = existingDeckId
        ? await updateDeck(existingDeckId, payload)
        : await saveDeck(payload);

      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deck');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[420px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 className="text-white font-semibold text-sm">
            {existingDeckId ? 'Update Deck' : 'Save Deck'}
          </h3>
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
        <div className="px-5 py-4 space-y-4">
          {/* Deck summary */}
          <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-3">
            {leader?.image_small && (
              <img src={leader.image_small} alt="" className="w-8 h-11 object-cover rounded" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 truncate">{leader?.name || 'No leader'}</p>
              <p className="text-[10px] text-gray-500">{totalCards}/50 cards</p>
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Deck Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Luffy Aggro Red"
              maxLength={100}
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Description input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Strategy notes, matchup info..."
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {saving && (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {existingDeckId ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
