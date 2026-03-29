import type { Card } from '../types';

interface Props {
  card: Card | null;
  onClose: () => void;
}

export default function CardDetail({ card, onClose }: Props) {
  if (!card) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-gray-900 text-white shadow-2xl overflow-y-auto z-50 p-6">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">
        &times;
      </button>

      <img
        src={card.image_large || card.image_small}
        alt={card.name}
        className="w-full rounded-lg mb-4"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />

      <h2 className="text-xl font-bold mb-1">{card.name}</h2>
      <p className="text-sm text-gray-400 mb-3">{card.id} &middot; {card.rarity} &middot; {card.card_type}</p>

      <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
        {card.cost !== null && (
          <div className="bg-gray-800 rounded p-2 text-center">
            <div className="text-gray-400">Cost</div>
            <div className="text-lg font-bold">{card.cost}</div>
          </div>
        )}
        {card.power !== null && (
          <div className="bg-gray-800 rounded p-2 text-center">
            <div className="text-gray-400">Power</div>
            <div className="text-lg font-bold">{card.power}</div>
          </div>
        )}
        {card.counter !== null && (
          <div className="bg-gray-800 rounded p-2 text-center">
            <div className="text-gray-400">Counter</div>
            <div className="text-lg font-bold">{card.counter}</div>
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
          <p className="text-sm bg-gray-800 rounded p-3">{card.ability}</p>
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
  );
}
