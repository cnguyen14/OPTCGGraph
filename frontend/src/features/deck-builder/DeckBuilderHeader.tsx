import type { Card } from '../../types';
import { Button } from '../../components/ui';

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

interface Props {
  leader: Card | null;
  totalCards: number;
  totalPrice: number;
  onPickLeader: () => void;
  onClearDeck: () => void;
  onClearLeader: () => void;
}

export default function DeckBuilderHeader({
  leader,
  totalCards,
  totalPrice,
  onPickLeader,
  onClearDeck,
  onClearLeader,
}: Props) {
  const colors = leader
    ? leader.colors?.length
      ? leader.colors
      : leader.color
        ? [leader.color]
        : []
    : [];

  return (
    <div className="shrink-0 border-b border-glass-border glass px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Leader Card */}
        {leader ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {leader.image_small ? (
              <img
                src={leader.image_small}
                alt={leader.name}
                className="w-12 h-16 object-cover rounded-md shadow-lg border border-glass-border"
              />
            ) : (
              <div
                className="w-12 h-16 rounded-md flex items-center justify-center"
                style={{ backgroundColor: COLOR_MAP[colors[0]] ?? '#374151' }}
              >
                <span className="text-text-primary text-[8px]">{leader.id}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-text-primary font-semibold text-sm truncate">{leader.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-text-muted font-mono">{leader.id}</span>
                {colors.map((c) => (
                  <span
                    key={c}
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                  />
                ))}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={onPickLeader}>
              Change
            </Button>
          </div>
        ) : (
          <div className="flex-1">
            <Button variant="primary" size="md" onClick={onPickLeader}>
              Choose a Leader
            </Button>
          </div>
        )}

        {/* Deck Stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center">
            <p className="text-lg font-bold text-text-primary">{totalCards}<span className="text-text-muted text-sm font-normal">/50</span></p>
            <p className="text-[10px] text-text-muted uppercase">Cards</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-400">${totalPrice.toFixed(2)}</p>
            <p className="text-[10px] text-text-muted uppercase">Price</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {leader && (
            <Button variant="secondary" size="sm" onClick={onClearLeader}>
              Reset Leader
            </Button>
          )}
          {totalCards > 0 && (
            <Button variant="danger" size="sm" onClick={onClearDeck}>
              Clear Deck
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
