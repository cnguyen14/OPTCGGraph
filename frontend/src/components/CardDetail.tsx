import type { Card } from '../types';
import { renderAbility } from '../lib/renderAbility';

interface Props {
  card: Card | null;
  onClose: () => void;
}

export default function CardDetail({ card, onClose }: Props) {
  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative flex max-w-3xl w-full max-h-[85vh] bg-gray-900 text-white shadow-2xl rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Card Image */}
        <div className="shrink-0 w-72 bg-gray-950 flex items-center justify-center p-4">
          <img
            src={card.image_large || card.image_small}
            alt={card.name}
            className="w-full rounded-lg"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* Right: Card Info */}
        <div className="flex-1 overflow-y-auto p-6">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">
            &times;
          </button>

          {card.banned && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-950/50 border border-red-700/40 text-xs text-red-400 font-medium">
              BANNED — This card is not legal for tournament play
            </div>
          )}

          <h2 className="text-xl font-bold mb-1 pr-8">{card.name}</h2>
          <p className="text-sm text-gray-400 mb-3">{card.id} &middot; {card.rarity} &middot; {card.card_type}</p>

          <div className="flex gap-2 mb-4 text-sm">
            {card.cost !== null && (
              <div className="bg-gray-800 rounded p-2 text-center min-w-16">
                <div className="text-gray-400 text-xs">Cost</div>
                <div className="text-lg font-bold">{card.cost}</div>
              </div>
            )}
            {card.power !== null && (
              <div className="bg-gray-800 rounded p-2 text-center min-w-16">
                <div className="text-gray-400 text-xs">Power</div>
                <div className="text-lg font-bold">{card.power}</div>
              </div>
            )}
            {card.counter !== null && (
              <div className="bg-gray-800 rounded p-2 text-center min-w-16">
                <div className="text-gray-400 text-xs">Counter</div>
                <div className="text-lg font-bold">{card.counter}</div>
              </div>
            )}
            {card.life && (
              <div className="bg-gray-800 rounded p-2 text-center min-w-16">
                <div className="text-gray-400 text-xs">Life</div>
                <div className="text-lg font-bold">{card.life}</div>
              </div>
            )}
          </div>

          {card.colors.length > 0 && (
            <div className="mb-3">
              <span className="text-gray-400 text-sm">Colors: </span>
              {card.colors.map(c => (
                <span key={c} className="inline-block bg-gray-700 rounded px-2 py-0.5 text-xs mr-1">{c}</span>
              ))}
            </div>
          )}

          {card.families.length > 0 && (
            <div className="mb-3">
              <span className="text-gray-400 text-sm">Family: </span>
              {card.families.map(f => (
                <span key={f} className="inline-block bg-gray-700 rounded px-2 py-0.5 text-xs mr-1">{f}</span>
              ))}
            </div>
          )}

          {card.ability && (
            <div className="mb-3">
              <div className="text-gray-400 text-sm mb-1">Ability</div>
              <div className="text-sm bg-gray-800 rounded p-3 leading-relaxed">{renderAbility(card.ability)}</div>
            </div>
          )}

          {card.keywords.length > 0 && (
            <div className="mb-3">
              <div className="text-gray-400 text-sm mb-1">Keywords</div>
              <div className="flex flex-wrap gap-1">
                {card.keywords.map(kw => (
                  <span key={kw} className="bg-blue-900 text-blue-200 rounded px-2 py-0.5 text-xs">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {(card.market_price || card.inventory_price) && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="text-gray-400 text-sm mb-1">Pricing</div>
              {card.market_price && <p className="text-sm">Market: <span className="text-green-400">${card.market_price.toFixed(2)}</span></p>}
              {card.inventory_price && <p className="text-sm">Inventory: <span className="text-yellow-400">${card.inventory_price.toFixed(2)}</span></p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
