import { useState } from 'react';
import type { Card } from '../types';
import { fetchDeckCandidates } from '../lib/api';

interface Props {
  onCardSelect: (card: Card) => void;
}

export default function DeckBuilder({ onCardSelect }: Props) {
  const [leaderId, setLeaderId] = useState('');
  const [candidates, setCandidates] = useState<Card[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCandidates = async () => {
    if (!leaderId.trim()) return;
    setLoading(true);
    try {
      const data = await fetchDeckCandidates(leaderId, 60);
      setCandidates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addToDeck = (card: Card) => {
    if (deck.length >= 50) return;
    if (deck.filter(c => c.id === card.id).length >= 4) return;
    setDeck(prev => [...prev, card]);
  };

  const removeFromDeck = (index: number) => {
    setDeck(prev => prev.filter((_, i) => i !== index));
  };

  const totalPrice = deck.reduce((sum, c) => sum + (c.market_price || 0), 0);
  const curve: Record<number, number> = {};
  deck.forEach(c => { if (c.cost != null) curve[c.cost] = (curve[c.cost] || 0) + 1; });

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Candidates Panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={leaderId}
            onChange={e => setLeaderId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadCandidates()}
            placeholder="Leader ID (e.g. OP01-001)"
            className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={loadCandidates} disabled={loading} className="bg-green-600 hover:bg-green-500 text-white rounded px-4 py-1.5 text-sm">
            {loading ? '...' : 'Find Cards'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {candidates.map(card => (
            <div
              key={card.id}
              className="flex items-center gap-2 bg-gray-800 rounded p-2 text-sm hover:bg-gray-700 cursor-pointer"
              onClick={() => onCardSelect(card)}
            >
              <span className="text-gray-400 w-20 shrink-0">{card.id}</span>
              <span className="text-white flex-1 truncate">{card.name}</span>
              <span className="text-gray-500 w-8 text-center">{card.cost ?? '-'}</span>
              <span className="text-green-400 w-14 text-right">${(card.market_price ?? 0).toFixed(2)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); addToDeck(card); }}
                className="bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-0.5 text-xs"
              >
                +
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Deck Panel */}
      <div className="w-80 flex flex-col border-l border-gray-800 pl-4">
        <h3 className="text-white font-semibold mb-2">Deck ({deck.length}/50)</h3>
        <p className="text-sm text-gray-400 mb-3">Total: ${totalPrice.toFixed(2)}</p>

        {/* Mini Curve */}
        <div className="flex items-end gap-1 h-16 mb-3">
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} className="flex flex-col items-center flex-1">
              <div
                className="bg-blue-600 w-full rounded-t"
                style={{ height: `${(curve[i] || 0) * 8}px` }}
              />
              <span className="text-[10px] text-gray-500">{i}</span>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {deck.map((card, i) => (
            <div key={`${card.id}-${i}`} className="flex items-center gap-2 text-xs bg-gray-800 rounded p-1.5">
              <span className="text-gray-400 w-16">{card.id}</span>
              <span className="text-white flex-1 truncate">{card.name}</span>
              <button onClick={() => removeFromDeck(i)} className="text-red-400 hover:text-red-300">&times;</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
