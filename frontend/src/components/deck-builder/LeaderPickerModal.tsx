import { useState, useEffect, useCallback, useRef } from 'react';
import { searchCards } from '../../lib/api';
import type { Card } from '../../types';

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

const COLORS = Object.keys(COLOR_MAP);

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (leader: Card) => void;
}

export default function LeaderPickerModal({ open, onClose, onSelect }: Props) {
  const [leaders, setLeaders] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedKeyword(value), 300);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    searchCards({
      card_type: 'LEADER',
      keyword: debouncedKeyword || undefined,
      color: colorFilter || undefined,
      limit: 100,
      sort_by: 'name',
      sort_order: 'asc',
    })
      .then((res) => {
        setLeaders(res.cards);
        setLoading(false);
      })
      .catch(() => {
        setLeaders([]);
        setLoading(false);
      });
  }, [open, debouncedKeyword, colorFilter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl border border-gray-700 w-[900px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Choose a Leader</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">
            &times;
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
          <input
            type="text"
            placeholder="Search leaders..."
            value={keyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
            className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
            autoFocus
          />
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColorFilter(colorFilter === c ? '' : c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  colorFilter === c ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                style={{ backgroundColor: COLOR_MAP[c] }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Leader Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="grid grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-gray-800 rounded-lg animate-pulse">
                  <div className="aspect-[3/4] bg-gray-700 rounded-t-lg" />
                  <div className="p-2 space-y-1">
                    <div className="h-3 bg-gray-700 rounded w-3/4" />
                    <div className="h-2 bg-gray-700 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : leaders.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <p>No leaders found</p>
              <p className="text-sm mt-1">Try a different search</p>
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-3">
              {leaders.map((leader) => {
                const colors = leader.colors?.length ? leader.colors : leader.color ? [leader.color] : [];
                return (
                  <div
                    key={leader.id}
                    onClick={() => {
                      onSelect(leader);
                      onClose();
                    }}
                    className="bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-105 hover:ring-2 hover:ring-blue-500"
                  >
                    {!imgErrors.has(leader.id) && leader.image_small ? (
                      <img
                        src={leader.image_small}
                        alt={leader.name}
                        className="w-full aspect-[3/4] object-cover"
                        loading="lazy"
                        onError={() => setImgErrors((prev) => new Set(prev).add(leader.id))}
                      />
                    ) : (
                      <div
                        className="w-full aspect-[3/4] flex items-center justify-center p-2"
                        style={{
                          backgroundColor: COLOR_MAP[colors[0]] ?? '#374151',
                        }}
                      >
                        <span className="text-white text-xs text-center font-medium">
                          {leader.name}
                        </span>
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs text-white truncate">{leader.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] text-gray-500">{leader.id}</span>
                        {colors.map((c) => (
                          <span
                            key={c}
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
