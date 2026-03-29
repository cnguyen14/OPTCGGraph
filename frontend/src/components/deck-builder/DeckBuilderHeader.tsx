import type { Card } from '../../types';

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
    <div className="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Leader Card */}
        {leader ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {leader.image_small ? (
              <img
                src={leader.image_small}
                alt={leader.name}
                className="w-12 h-16 object-cover rounded-md shadow-lg border border-gray-700"
              />
            ) : (
              <div
                className="w-12 h-16 rounded-md flex items-center justify-center"
                style={{ backgroundColor: COLOR_MAP[colors[0]] ?? '#374151' }}
              >
                <span className="text-white text-[8px]">{leader.id}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{leader.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-gray-500 font-mono">{leader.id}</span>
                {colors.map((c) => (
                  <span
                    key={c}
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={onPickLeader}
              className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 hover:bg-gray-800 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex-1">
            <button
              onClick={onPickLeader}
              className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
            >
              Choose a Leader
            </button>
          </div>
        )}

        {/* Deck Stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{totalCards}<span className="text-gray-500 text-sm font-normal">/50</span></p>
            <p className="text-[10px] text-gray-500 uppercase">Cards</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-400">${totalPrice.toFixed(2)}</p>
            <p className="text-[10px] text-gray-500 uppercase">Price</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {leader && (
            <button
              onClick={onClearLeader}
              className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors"
            >
              Reset Leader
            </button>
          )}
          {totalCards > 0 && (
            <button
              onClick={onClearDeck}
              className="text-xs text-red-400 hover:text-red-300 border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors"
            >
              Clear Deck
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
