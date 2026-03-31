import { useState } from 'react';
import type { Card, DeckEntry } from '../../types';
import CostCurve from './CostCurve';
import DeckCardList from './DeckCardList';
import DeckValidationModal from './DeckValidationModal';

interface Props {
  entries: Map<string, DeckEntry>;
  totalCards: number;
  totalPrice: number;
  costCurve: Record<number, number>;
  leader: Card | null;
  highlightedCardIds?: string[] | null;
  onAdd: (card: Card) => void;
  onRemove: (cardId: string) => void;
  onCardSelect: (card: Card) => void;
  onBulkReplace: (removes: string[], adds: Card[]) => void;
}

export default function DeckPanel({
  entries,
  totalCards,
  totalPrice,
  costCurve,
  leader,
  highlightedCardIds,
  onAdd,
  onRemove,
  onCardSelect,
  onBulkReplace,
}: Props) {
  const [showValidation, setShowValidation] = useState(false);

  // Type distribution
  const typeCount: Record<string, number> = {};
  for (const { card, quantity } of entries.values()) {
    const t = card.card_type || 'Unknown';
    typeCount[t] = (typeCount[t] || 0) + quantity;
  }

  return (
    <div className="w-[420px] shrink-0 border-l border-gray-800 flex flex-col bg-gray-900/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-800/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm">Deck</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {totalCards}/50 &middot; ${totalPrice.toFixed(2)}
            </span>
            {leader && totalCards >= 10 && (
              <button
                onClick={() => setShowValidation(true)}
                className="px-2.5 py-1 text-[11px] font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
              >
                Validate
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${(totalCards / 50) * 100}%`,
              backgroundColor: totalCards >= 50 ? '#22c55e' : totalCards >= 40 ? '#eab308' : '#3b82f6',
            }}
          />
        </div>

        {/* Type breakdown */}
        {Object.keys(typeCount).length > 0 && (
          <div className="flex gap-3 mt-2">
            {Object.entries(typeCount)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <span key={type} className="text-[10px] text-gray-500">
                  {type}: <span className="text-gray-400">{count}</span>
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Cost Curve */}
      <div className="px-3 py-2">
        <CostCurve curve={costCurve} />
      </div>

      {/* Card List */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 pb-3">
        <DeckCardList
          entries={entries}
          highlightedCardIds={highlightedCardIds}
          onAdd={onAdd}
          onRemove={onRemove}
          onCardSelect={onCardSelect}
        />
      </div>

      {/* Validation Modal */}
      {leader && showValidation && (
        <DeckValidationModal
          open={showValidation}
          leader={leader}
          entries={entries}
          onApply={(removes, adds) => onBulkReplace(removes, adds)}
          onClose={() => setShowValidation(false)}
        />
      )}
    </div>
  );
}
