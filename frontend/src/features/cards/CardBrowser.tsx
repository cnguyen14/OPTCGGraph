import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCards, fetchFacets } from '../../lib/api';
import type { Card, CardSearchParams, Facets } from '../../types';
import { GlassCard, Button, Input, Select } from '../../components/ui';

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
  const [rarity, setRarity] = useState('');
  const [costMin, setCostMin] = useState<string>('');
  const [costMax, setCostMax] = useState<string>('');

  // Sort
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Facets
  const [facets, setFacets] = useState<Facets>({ colors: [], card_types: [], families: [], sets: [], rarities: [] });

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

    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, color, cardType, family, setName, rarity, costMin, costMax, sortBy, sortOrder, page]);

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
    setRarity('');
    setCostMin('');
    setCostMax('');
    setSortBy('name');
    setSortOrder('asc');
    setPage(0);
  };

  const handleImgError = (cardId: string) => {
    setImgErrors((prev) => new Set(prev).add(cardId));
  };

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden">
      {/* Filter Sidebar */}
      <GlassCard className="w-60 shrink-0 overflow-y-auto p-4 space-y-5">
        {/* Search */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Search</label>
          <Input
            type="text"
            placeholder="Search cards..."
            value={keyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
          />
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block">Filters</label>

          <Select
            label="Color"
            value={color}
            onChange={(e) => { setColor(e.target.value); setPage(0); }}
          >
            <option value="">All Colors</option>
            {facets.colors.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>

          <Select
            label="Type"
            value={cardType}
            onChange={(e) => { setCardType(e.target.value); setPage(0); }}
          >
            <option value="">All Types</option>
            {facets.card_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>

          <Select
            label="Family"
            value={family}
            onChange={(e) => { setFamily(e.target.value); setPage(0); }}
          >
            <option value="">All Families</option>
            {facets.families.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </Select>

          <Select
            label="Rarity"
            value={rarity}
            onChange={(e) => { setRarity(e.target.value); setPage(0); }}
          >
            <option value="">All Rarities</option>
            {facets.rarities.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>

          <Select
            label="Set"
            value={setName}
            onChange={(e) => { setSetName(e.target.value); setPage(0); }}
          >
            <option value="">All Sets</option>
            {facets.sets.map((s) => (
              <option key={s.id} value={s.id}>{s.id} - {s.name}</option>
            ))}
          </Select>
        </div>

        {/* Cost Range */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Cost Range</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={costMin}
              onChange={(e) => { setCostMin(e.target.value); setPage(0); }}
              min={0}
            />
            <span className="text-text-muted text-sm shrink-0">—</span>
            <Input
              type="number"
              placeholder="Max"
              value={costMax}
              onChange={(e) => { setCostMax(e.target.value); setPage(0); }}
              min={0}
            />
          </div>
        </div>

        {/* Sort */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Sort</label>
          <div className="flex gap-2">
            <Select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as SortField); setPage(0); }}
              className="flex-1"
            >
              <option value="name">Name</option>
              <option value="cost">Cost</option>
              <option value="power">Power</option>
              <option value="market_price">Price</option>
            </Select>
            <Button
              variant={sortOrder === 'asc' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(0); }}
              className="shrink-0"
            >
              {sortOrder === 'asc' ? 'ASC' : 'DESC'}
            </Button>
          </div>
        </div>

        {/* View Mode */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">View</label>
          <div className="flex gap-0.5">
            <Button
              variant={viewMode === 'grid' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="flex-1 !rounded-r-none"
            >
              Grid
            </Button>
            <Button
              variant={viewMode === 'list' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="flex-1 !rounded-l-none"
            >
              List
            </Button>
          </div>
        </div>

        {/* Reset */}
        <Button variant="ghost" size="sm" onClick={handleFilterReset} className="w-full">
          Reset Filters
        </Button>
      </GlassCard>

      {/* Right Section — Cards + Pagination */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            /* Skeleton Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="glass-subtle rounded-lg overflow-hidden animate-pulse">
                  <div className="aspect-[3/4] bg-surface-2" />
                  <div className="p-2 space-y-1">
                    <div className="h-3 bg-surface-2 rounded w-3/4" />
                    <div className="h-3 bg-surface-2 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : cards.length === 0 ? (
            /* Empty State */
            <div className="flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <p className="text-lg">No cards found</p>
                <p className="text-sm mt-1 text-text-secondary">Try adjusting your filters</p>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            /* Card Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {cards.map((card) => (
                <GlassCard
                  key={card.id}
                  variant="subtle"
                  hover
                  onClick={() => onCardSelect(card)}
                  className="rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105 hover:ring-2 hover:ring-op-ocean relative"
                >
                  {card.banned && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                      <div className="absolute inset-0 bg-red-900/30" />
                      <span className="relative -rotate-25 text-lg font-black text-red-500 tracking-widest uppercase px-3 py-1 border-3 border-red-500 rounded bg-black/60">
                        BANNED
                      </span>
                    </div>
                  )}
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
                      style={{ backgroundColor: COLOR_MAP[splitColors(card.colors?.length ? card.colors : card.color ? [card.color] : [])[0]] ?? '#374151' }}
                    >
                      <span className="text-white text-xs text-center font-medium leading-tight">
                        {card.name}
                      </span>
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs text-text-primary truncate" title={card.name}>
                      {card.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {card.cost !== null && (
                        <span className="text-[10px] bg-surface-2 rounded px-1.5 py-0.5 text-text-secondary">
                          {card.cost}
                        </span>
                      )}
                      {splitColors(card.colors?.length ? card.colors : card.color ? [card.color] : []).map((c) => (
                        <span
                          key={c}
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : (
            /* Card List */
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-text-secondary border-b border-glass-border">
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
                      className="border-b border-glass-border/50 hover:bg-surface-1 cursor-pointer transition-colors"
                    >
                      <td className="py-1.5 px-2">
                        <div className="relative w-10 h-14">
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
                              style={{ backgroundColor: COLOR_MAP[splitColors(card.colors?.length ? card.colors : card.color ? [card.color] : [])[0]] ?? '#374151' }}
                            >
                              <span className="text-white text-[8px] text-center leading-tight">
                                {card.code}
                              </span>
                            </div>
                          )}
                          {card.banned && (
                            <div className="absolute inset-0 bg-red-900/40 rounded flex items-center justify-center">
                              <span className="text-[6px] font-black text-red-400 uppercase tracking-wider">BAN</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-text-muted font-mono text-xs">{card.code}</td>
                      <td className="py-1.5 px-2 text-text-primary">
                        {card.name}
                        {card.banned && (
                          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-black bg-red-700 text-white rounded uppercase tracking-wider border border-red-500">
                            BANNED
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-text-secondary">{card.card_type}</td>
                      <td className="py-1.5 px-2 text-text-secondary">{card.cost ?? '-'}</td>
                      <td className="py-1.5 px-2 text-text-secondary">{card.power ?? '-'}</td>
                      <td className="py-1.5 px-2">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {splitColors(card.colors?.length ? card.colors : card.color ? [card.color] : []).map((c) => (
                            <span key={c} className="flex items-center gap-1">
                              <span
                                className="w-2.5 h-2.5 rounded-full inline-block"
                                style={{ backgroundColor: COLOR_MAP[c] ?? '#6b7280' }}
                              />
                              <span className="text-text-secondary">{c}</span>
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-text-secondary">
                        {card.market_price != null ? `$${card.market_price.toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <GlassCard variant="subtle" className="shrink-0 mt-3 px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-text-secondary">
            Showing {showStart}-{showEnd} of {total} cards
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </Button>
            <span className="text-text-secondary">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
