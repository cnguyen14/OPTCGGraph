import { useState } from 'react';
import type { Card, DeckEntry, SavedDeck } from '../../types';
import { saveDeck, updateDeck } from '../../lib/api';
import { Modal, Input, Button, Spinner } from '../../components/ui';

function parseApiError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const details = parsed?.detail;
    if (Array.isArray(details)) {
      return details.map((d: { loc?: string[]; msg?: string }) => {
        const field = d.loc?.filter((l) => l !== 'body').join(' > ') || '';
        const msg = d.msg || 'Invalid value';
        if (field.includes('quantity')) return `Card quantity exceeds maximum of 4 copies`;
        if (field.includes('entries')) return `Deck has an issue: ${msg}`;
        return field ? `${field}: ${msg}` : msg;
      }).join('. ');
    }
    if (typeof parsed?.detail === 'string') return parsed.detail;
  } catch { /* not JSON */ }

  if (raw.includes('less_than_equal') && raw.includes('quantity')) {
    return 'Some cards exceed the maximum of 4 copies per card';
  }
  return raw;
}

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

  const totalCards = Array.from(entries.values()).reduce((s, e) => s + e.quantity, 0);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a deck name');
      return;
    }
    if (totalCards > 50) {
      setError(`Deck has ${totalCards} cards — maximum is 50. Please remove ${totalCards - 50} card(s).`);
      return;
    }
    // Check max 4 copies
    for (const [, entry] of entries) {
      if (entry.quantity > 4) {
        setError(`"${entry.card.name}" has ${entry.quantity} copies — maximum is 4.`);
        return;
      }
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
      const raw = err instanceof Error ? err.message : 'Failed to save deck';
      setError(parseApiError(raw));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={existingDeckId ? 'Update Deck' : 'Save Deck'} size="sm">
      <div className="space-y-4">
        {/* Deck summary */}
        <div className="flex items-center gap-3 bg-surface-2 rounded-lg p-3">
          {leader?.image_small && (
            <img src={leader.image_small} alt="" className="w-8 h-11 object-cover rounded" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-secondary truncate">{leader?.name || 'No leader'}</p>
            <p className="text-[10px] text-text-muted">{totalCards}/50 cards</p>
          </div>
        </div>

        {/* Name input */}
        <Input
          label="Deck Name *"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Luffy Aggro Red"
          maxLength={100}
          autoFocus
        />

        {/* Description input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-secondary">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Strategy notes, matchup info..."
            rows={2}
            className="w-full bg-surface-1 border border-glass-border rounded-[var(--radius-glass-sm)] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all focus:bg-surface-2 focus:border-op-ocean focus:ring-1 focus:ring-op-ocean/30 resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-glass-border">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !name.trim()}
        >
          {saving && <Spinner size="sm" />}
          {existingDeckId ? 'Update' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
