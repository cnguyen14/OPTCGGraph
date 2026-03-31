import { useState, useEffect, useCallback, useRef } from 'react';
import { searchCards, fetchFacets, fetchDeckCandidates } from '../../lib/api';
import type { Card, CardSearchParams, Facets } from '../../types';
import CardTooltip, { useCardTooltip } from './CardTooltip';

const PAGE_SIZE = 24;

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

const BASE_COLORS = Object.keys(COLOR_MAP);

function splitColors(colors: string[]): string[] {
  const result: string[] = [];
  for (const c of colors) {
    if (COLOR_MAP[c]) {
      result.push(c);
    } else {
      for (const base of BASE_COLORS) {
        if (c.includes(base) && !result.includes(base)) result.push(base);
      }
    }
  }
  return result.length ? result : colors;
}

type PoolMode = 'suggested' | 'browse';

interface Props {
  leader: Card | null;
  getQuantity: (cardId: string) => number;
  onAddCard: (card: Card) => void;
  onCardSelect: (card: Card) => void;
}

export default function CardPool({ leader, getQuantity, onAddCard, onCardSelect }: Props) {
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCardTooltip();
  const [mode, setMode] = useState<PoolMode>('suggested');
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  // Filters (browse mode)
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [color, setColor] = useState('');
  const [cardType, setCardType] = useState('');
  const [family, setFamily] = useState('');
  const [setName, setSetName] = useState('');
  const [rarity, setRarity] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'cost' | 'power' | 'market_price'>('cost');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [facets, setFacets] = useState<Facets>({ colors: [], card_types: [], families: [], sets: [], rarities: [] });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  // Load facets once
  useEffect(() => {
    fetchFacets().then(setFacets).catch(() => {});
  }, []);

  // Debounce keyword
  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedKeyword(value);
      setPage(0);
    }, 300);
  }, []);

  // Auto-set leader color as default filter when leader changes
  useEffect(() => {
    if (leader) {
      const leaderColors = leader.colors?.length ? leader.colors : leader.color ? [leader.color] : [];
      if (leaderColors.length === 1) {
        setColor(leaderColors[0]);
      }
    }
  }, [leader]);

  // Fetch cards based on mode
  useEffect(() => {
    if (mode === 'suggested') {
      if (!leader) {
        setCards([]);
        setTotal(0);
        return;
      }
      setLoading(true);
      fetchDeckCandidates(leader.id, 60)
        .then((data: Card[]) => {
          setCards(data);
          setTotal(data.length);
          setLoading(false);
        })
        .catch(() => {
          setCards([]);
          setTotal(0);
          setLoading(false);
        });
    } else {
      // Browse mode
      let cancelled = false;
      setLoading(true);

      const params: CardSearchParams = {
        keyword: debouncedKeyword || undefined,
        color: color || undefined,
        card_type: cardType || undefined,
        family: family || undefined,
        set_name: setName || undefined,
        rarity: rarity || undefined,
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

      return () => { cancelled = true; };
    }
  }, [mode, leader, debouncedKeyword, color, cardType, family, setName, rarity, costMin, costMax, sortBy, sortOrder, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleFilterReset = () => {
    setKeyword('');
    setDebouncedKeyword('');
    setColor('');
    setCardType('');
    setFamily('');
    setSetName('');
    setRarity('');
    setCostMin('');
    setCostMax('');
    setSortBy('cost');
    setSortOrder('asc');
    setPage(0);
  };

  const inputClass =
    'bg-gray-800 text-white rounded px-2.5 py-1.5 text-xs border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500';

  const handleCardClick = (card: Card, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onCardSelect(card);
    } else {
      onAddCard(card);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode Toggle + Filters */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-2 space-y-2">
        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <button
              onClick={() => { setMode('suggested'); setPage(0); }}
              className={`px-3 py-1 rounded-l text-xs border border-gray-700 ${
                mode === 'suggested' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Suggested
            </button>
            <button
              onClick={() => { setMode('browse'); setPage(0); }}
              className={`px-3 py-1 rounded-r text-xs border border-gray-700 ${
                mode === 'browse' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Browse All
            </button>
          </div>

          {mode === 'suggested' && !leader && (
            <span className="text-xs text-gray-500 italic">Select a leader to see suggestions</span>
          )}

          {mode === 'browse' && (
            <>
              <input
                type="text"
                placeholder="Search cards..."
                value={keyword}
                onChange={(e) => handleKeywordChange(e.target.value)}
                className={`${inputClass} w-40`}
              />
              <select value={color} onChange={(e) => { setColor(e.target.value); setPage(0); }} className={inputClass}>
                <option value="">All Colors</option>
                {facets.colors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={cardType} onChange={(e) => { setCardType(e.target.value); setPage(0); }} className={inputClass}>
                <option value="">All Types</option>
                {facets.card_types.filter(t => t !== 'LEADER').map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={family} onChange={(e) => { setFamily(e.target.value); setPage(0); }} className={inputClass}>
                <option value="">All Families</option>
                {facets.families.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={rarity} onChange={(e) => { setRarity(e.target.value); setPage(0); }} className={inputClass}>
                <option value="">All Rarities</option>
                {facets.rarities.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </>
          )}
        </div>

        {mode === 'browse' && (
          <div className="flex items-center gap-2">
            <select value={setName} onChange={(e) => { setSetName(e.target.value); setPage(0); }} className={inputClass}>
              <option value="">All Sets</option>
              {facets.sets.map((s) => <option key={s.id} value={s.name}>{s.id} - {s.name}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <input type="number" placeholder="Min" value={costMin} onChange={(e) => { setCostMin(e.target.value); setPage(0); }} className={`${inputClass} w-14`} min={0} />
              <span className="text-gray-500 text-xs">-</span>
              <input type="number" placeholder="Max" value={costMax} onChange={(e) => { setCostMax(e.target.value); setPage(0); }} className={`${inputClass} w-14`} min={0} />
            </div>
            <select value={sortBy} onChange={(e) => { setSortBy(e.target.value as typeof sortBy); setPage(0); }} className={inputClass}>
              <option value="cost">Cost</option>
              <option value="name">Name</option>
              <option value="power">Power</option>
              <option value="market_price">Price</option>
            </select>
            <button
              onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(0); }}
              className={`px-2 py-1.5 rounded text-xs border border-gray-700 ${
                sortOrder === 'asc' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              {sortOrder === 'asc' ? 'ASC' : 'DESC'}
            </button>
            <button onClick={handleFilterReset} className="text-xs text-gray-500 hover:text-white px-2 py-1.5 border border-gray-700 rounded hover:bg-gray-800">
              Reset
            </button>
            <span className="text-xs text-gray-600 ml-auto">Ctrl+Click to view details</span>
          </div>
        )}
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({ length: 15 }).map((_, i) => (
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
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              {mode === 'suggested' ? (
                <>
                  <p className="text-lg">No suggested cards</p>
                  <p className="text-sm mt-1">Select a leader or switch to Browse All</p>
                </>
              ) : (
                <>
                  <p className="text-lg">No cards found</p>
                  <p className="text-sm mt-1">Try adjusting your filters</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {cards.map((card) => {
              const qty = getQuantity(card.id);
              const colors = splitColors(card.colors?.length ? card.colors : card.color ? [card.color] : []);
              const maxed = qty >= 4;

              return (
                <div
                  key={card.id}
                  onClick={(e) => handleCardClick(card, e)}
                  onMouseEnter={(e) => showTooltip(card, e)}
                  onMouseLeave={hideTooltip}
                  className={`bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-105 relative ${
                    maxed
                      ? 'opacity-40 ring-1 ring-gray-600'
                      : qty > 0
                        ? 'ring-2 ring-blue-500/50 hover:ring-blue-500'
                        : 'hover:ring-2 hover:ring-blue-500'
                  }`}
                >
                  {/* Quantity badge */}
                  {qty > 0 && (
                    <div className={`absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-lg ${
                      maxed ? 'bg-gray-600 text-gray-300' : 'bg-blue-600 text-white'
                    }`}>
                      {qty}
                    </div>
                  )}

                  {/* Card Image */}
                  {!imgErrors.has(card.id) && card.image_small ? (
                    <img
                      src={card.image_small}
                      alt={card.name}
                      className="w-full aspect-[3/4] object-cover"
                      loading="lazy"
                      onError={() => setImgErrors((prev) => new Set(prev).add(card.id))}
                    />
                  ) : (
                    <div
                      className="w-full aspect-[3/4] flex items-center justify-center p-2"
                      style={{ backgroundColor: COLOR_MAP[colors[0]] ?? '#374151' }}
                    >
                      <span className="text-white text-xs text-center font-medium leading-tight">
                        {card.name}
                      </span>
                    </div>
                  )}

                  {/* Card Info */}
                  <div className="p-2">
                    <p className="text-xs text-white truncate" title={card.name}>{card.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {card.cost !== null && (
                        <span className="text-[10px] bg-gray-700 rounded px-1.5 py-0.5 text-gray-300">
                          {card.cost}
                        </span>
                      )}
                      {colors.map((c) => (
                        <span
                          key={c}
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                        />
                      ))}
                      {card.market_price !== null && (
                        <span className="text-[10px] text-green-500 ml-auto">${card.market_price.toFixed(2)}</span>
                      )}
                    </div>
                    {/* Synergy badges (suggested mode) */}
                    {mode === 'suggested' && (card.shared_families?.length > 0 || card.shared_keywords?.length > 0) && (
                      <div className="flex items-center gap-1 mt-1">
                        {card.shared_families?.length > 0 && (
                          <span
                            className="text-[10px] bg-amber-900/50 text-amber-400 rounded px-1 py-0.5"
                            title={`Family: ${card.shared_families.join(', ')}`}
                          >
                            F:{card.shared_families.length}
                          </span>
                        )}
                        {card.shared_keywords?.length > 0 && (
                          <span
                            className="text-[10px] bg-purple-900/50 text-purple-400 rounded px-1 py-0.5"
                            title={`Keywords: ${card.shared_keywords.join(', ')}`}
                          >
                            K:{card.shared_keywords.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Hover Tooltip */}
      {tooltip && <CardTooltip tooltip={tooltip} />}

      {/* Pagination (browse mode only) */}
      {mode === 'browse' && total > PAGE_SIZE && (
        <div className="shrink-0 border-t border-gray-800 bg-gray-900 px-4 py-2 flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {total > 0 ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}` : '0'} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 rounded text-xs border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700"
            >
              Prev
            </button>
            <span className="text-gray-400">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1 rounded text-xs border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
