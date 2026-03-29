import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCards, fetchFacets } from '../lib/api';
import type { Card, CardSearchParams, Facets } from '../types';

const PAGE_SIZE = 24;

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

interface CardBrowserProps {
  onCardSelect: (card: Card) => void;
}

type ViewMode = 'grid' | 'list';
type SortField = 'name' | 'cost' | 'power' | 'market_price';
type SortOrder = 'asc' | 'desc';

export default function CardBrowser({ onCardSelect }: CardBrowserProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Filters
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [color, setColor] = useState('');
  const [cardType, setCardType] = useState('');
  const [family, setFamily] = useState('');
  const [setName, setSetName] = useState('');
  const [costMin, setCostMin] = useState<string>('');
  const [costMax, setCostMax] = useState<string>('');

  // Sort
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Facets
  const [facets, setFacets] = useState<Facets>({ colors: [], card_types: [], families: [], sets: [] });

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Image error tracking
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  // Fetch facets once on mount
  useEffect(() => {
    fetchFacets()
      .then(setFacets)
      .catch(() => {
        // Facets endpoint may not exist yet; use empty defaults
      });
  }, []);

  // Debounce keyword input
  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedKeyword(value);
      setPage(0);
    }, 300);
  }, []);

  // Search when filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params: CardSearchParams = {
      keyword: debouncedKeyword || undefined,
      color: color || undefined,
      card_type: cardType || undefined,
      family: family || undefined,
      set_name: setName || undefined,
      cost_min: costMin !== '' ? Number(costMin) : undefined,
      cost_max: costMax !== '' ? Number(costMax) : undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    };

    searchCards(params)
      .then((res) => {
        if (!cancelled) {
          setCards(res.cards);
          setTotal(res.total);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCards([]);
          setTotal(0);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, color, cardType, family, setName, costMin, costMax, sortBy, sortOrder, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showStart = total > 0 ? page * PAGE_SIZE + 1 : 0;
  const showEnd = Math.min((page + 1) * PAGE_SIZE, total);

  const handleFilterReset = () => {
    setKeyword('');
    setDebouncedKeyword('');
    setColor('');
    setCardType('');
    setFamily('');
    setSetName('');
    setCostMin('');
    setCostMax('');
    setSortBy('name');
    setSortOrder('asc');
    setPage(0);
  };

  const inputClass =
    'bg-gray-800 text-white rounded px-3 py-1.5 text-sm border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500';

  const handleImgError = (cardId: string) => {
    setImgErrors((prev) => new Set(prev).add(cardId));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Filter Bar */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Keyword */}
          <input
            type="text"
            placeholder="Search cards..."
            value={keyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
            className={`${inputClass} w-48`}
          />

          {/* Color */}
          <select
            value={color}
            onChange={(e) => { setColor(e.target.value); setPage(0); }}
            className={inputClass}
          >
            <option value="">All Colors</option>
            {facets.colors.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Type */}
          <select
            value={cardType}
            onChange={(e) => { setCardType(e.target.value); setPage(0); }}
            className={inputClass}
          >
            <option value="">All Types</option>
            {facets.card_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Family */}
          <select
            value={family}
            onChange={(e) => { setFamily(e.target.value); setPage(0); }}
            className={inputClass}
          >
            <option value="">All Families</option>
            {facets.families.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          {/* Set */}
          <select
            value={setName}
            onChange={(e) => { setSetName(e.target.value); setPage(0); }}
            className={inputClass}
          >
            <option value="">All Sets</option>
            {facets.sets.map((s) => (
              <option key={s.id} value={s.name}>{s.id} - {s.name}</option>
            ))}
          </select>

          {/* Cost Range */}
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="Min"
              value={costMin}
              onChange={(e) => { setCostMin(e.target.value); setPage(0); }}
              className={`${inputClass} w-16`}
              min={0}
            />
            <span className="text-gray-500 text-sm">-</span>
            <input
              type="number"
              placeholder="Max"
              value={costMax}
              onChange={(e) => { setCostMax(e.target.value); setPage(0); }}
              className={`${inputClass} w-16`}
              min={0}
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as SortField); setPage(0); }}
            className={inputClass}
          >
            <option value="name">Name</option>
            <option value="cost">Cost</option>
            <option value="power">Power</option>
            <option value="market_price">Price</option>
          </select>

          <button
            onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(0); }}
            className={`px-3 py-1.5 rounded text-sm border border-gray-700 ${
              sortOrder === 'asc' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
            }`}
          >
            {sortOrder === 'asc' ? 'ASC' : 'DESC'}
          </button>

          {/* View Mode */}
          <div className="flex gap-0.5 ml-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-l text-sm border border-gray-700 ${
                viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-r text-sm border border-gray-700 ${
                viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              List
            </button>
          </div>

          <button
            onClick={handleFilterReset}
            className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          /* Skeleton Grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <div key={i} className="bg-gray-800 rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-gray-700" />
                <div className="p-2 space-y-1">
                  <div className="h-3 bg-gray-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-700 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          /* Empty State */
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg">No cards found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* Card Grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {cards.map((card) => (
              <div
                key={card.id}
                onClick={() => onCardSelect(card)}
                className="bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105 hover:ring-2 hover:ring-blue-500"
              >
                {!imgErrors.has(card.id) && card.image_small ? (
                  <img
                    src={card.image_small}
                    alt={card.name}
                    className="w-full aspect-[3/4] object-cover"
                    loading="lazy"
                    onError={() => handleImgError(card.id)}
                  />
                ) : (
                  <div
                    className="w-full aspect-[3/4] flex items-center justify-center p-2"
                    style={{ backgroundColor: COLOR_MAP[card.color] ?? '#374151' }}
                  >
                    <span className="text-white text-xs text-center font-medium leading-tight">
                      {card.name}
                    </span>
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs text-white truncate" title={card.name}>
                    {card.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {card.cost !== null && (
                      <span className="text-[10px] bg-gray-700 rounded px-1.5 py-0.5 text-gray-300">
                        {card.cost}
                      </span>
                    )}
                    <span
                      className="w-2 h-2 rounded-full inline-block"
                      style={{ backgroundColor: COLOR_MAP[card.color] ?? '#6b7280' }}
                      title={card.color}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Card List */
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="py-2 px-2">Image</th>
                  <th className="py-2 px-2">ID</th>
                  <th className="py-2 px-2">Name</th>
                  <th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2">Cost</th>
                  <th className="py-2 px-2">Power</th>
                  <th className="py-2 px-2">Color</th>
                  <th className="py-2 px-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr
                    key={card.id}
                    onClick={() => onCardSelect(card)}
                    className="border-b border-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors"
                  >
                    <td className="py-1.5 px-2">
                      {!imgErrors.has(card.id) && card.image_small ? (
                        <img
                          src={card.image_small}
                          alt={card.name}
                          className="w-10 h-14 object-cover rounded"
                          loading="lazy"
                          onError={() => handleImgError(card.id)}
                        />
                      ) : (
                        <div
                          className="w-10 h-14 rounded flex items-center justify-center"
                          style={{ backgroundColor: COLOR_MAP[card.color] ?? '#374151' }}
                        >
                          <span className="text-white text-[8px] text-center leading-tight">
                            {card.code}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-gray-400 font-mono text-xs">{card.code}</td>
                    <td className="py-1.5 px-2 text-white">{card.name}</td>
                    <td className="py-1.5 px-2 text-gray-300">{card.card_type}</td>
                    <td className="py-1.5 px-2 text-gray-300">{card.cost ?? '-'}</td>
                    <td className="py-1.5 px-2 text-gray-300">{card.power ?? '-'}</td>
                    <td className="py-1.5 px-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{ backgroundColor: COLOR_MAP[card.color] ?? '#6b7280' }}
                        />
                        {card.color}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-300">
                      {card.market_price !== null ? `$${card.market_price.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-900 px-4 py-2 flex items-center justify-between text-sm">
        <span className="text-gray-400">
          Showing {showStart}-{showEnd} of {total} cards
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded text-sm border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
          >
            Prev
          </button>
          <span className="text-gray-300">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 rounded text-sm border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
