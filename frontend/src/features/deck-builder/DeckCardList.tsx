import { useEffect, useMemo } from 'react';
import type { Card, DeckEntry } from '../../types';
import CardTooltip, { useCardTooltip } from './CardTooltip';

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

interface Props {
  entries: Map<string, DeckEntry>;
  highlightedCardIds?: string[] | null;
  onAdd: (card: Card) => void;
  onRemove: (cardId: string) => void;
  onCardSelect: (card: Card) => void;
}

export default function DeckCardList({ entries, highlightedCardIds, onAdd, onRemove, onCardSelect }: Props) {
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCardTooltip();
  const sorted = Array.from(entries.values()).sort((a, b) => {
    // Sort by cost, then by name
    const costA = a.card.cost ?? 99;
    const costB = b.card.cost ?? 99;
    if (costA !== costB) return costA - costB;
    return a.card.name.localeCompare(b.card.name);
  });

  const highlightSet = useMemo(() => new Set(highlightedCardIds ?? []), [highlightedCardIds]);

  // Auto-scroll to first highlighted card
  useEffect(() => {
    if (highlightedCardIds?.length) {
      const el = document.getElementById(`deck-card-${highlightedCardIds[0]}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightedCardIds]);

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm py-8">
        <p>Click cards to add them here</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-0.5">
      {sorted.map(({ card, quantity }) => {
        const colors = card.colors?.length ? card.colors : card.color ? [card.color] : [];
        const primaryColor = colors[0];
        const isHighlighted = highlightSet.has(card.id);

        return (
          <div
            key={card.id}
            id={`deck-card-${card.id}`}
            className={`flex items-center gap-2 rounded p-1.5 group cursor-pointer transition-all duration-200 ${
              isHighlighted
                ? 'bg-purple-800/50 ring-1 ring-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                : 'bg-surface-2/60 hover:bg-surface-3'
            }`}
            onClick={() => onCardSelect(card)}
            onMouseEnter={(e) => showTooltip(card, e)}
            onMouseLeave={hideTooltip}
          >
            {/* Thumbnail */}
            {card.image_small ? (
              <img
                src={card.image_small}
                alt={card.name}
                className="w-8 h-11 object-cover rounded shrink-0"
                loading="lazy"
              />
            ) : (
              <div
                className="w-8 h-11 rounded shrink-0 flex items-center justify-center"
                style={{ backgroundColor: COLOR_MAP[primaryColor] ?? '#374151' }}
              >
                <span className="text-white text-[6px]">{card.id}</span>
              </div>
            )}

            {/* Card info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary truncate">{card.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {card.cost !== null && (
                  <span className="text-[9px] text-text-muted">{card.cost}</span>
                )}
                {colors.map((c) => (
                  <span
                    key={c}
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                  />
                ))}
              </div>
            </div>

            {/* Quantity controls */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => onRemove(card.id)}
                className="w-5 h-5 rounded text-[10px] bg-surface-3 hover:bg-red-600 text-text-secondary hover:text-white transition-colors flex items-center justify-center"
              >
                -
              </button>
              <span className="text-xs text-text-primary w-4 text-center font-medium">{quantity}</span>
              <button
                onClick={() => onAdd(card)}
                className="w-5 h-5 rounded text-[10px] bg-surface-3 hover:bg-op-ocean text-text-secondary hover:text-white transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={quantity >= 4}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Hover Tooltip */}
      {tooltip && <CardTooltip tooltip={tooltip} />}
    </div>
  );
}
