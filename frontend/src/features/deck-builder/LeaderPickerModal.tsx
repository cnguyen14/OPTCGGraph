import { useState, useEffect, useCallback, useRef } from 'react';
import { searchCards } from '../../lib/api';
import type { Card } from '../../types';
import CardTooltip, { useCardTooltip } from './CardTooltip';
import { Modal, Input } from '../../components/ui';

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
  const [colorFilters, setColorFilters] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCardTooltip();

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
      color: colorFilters.size === 1 ? [...colorFilters][0] : undefined,
      limit: 100,
      sort_by: 'name',
      sort_order: 'asc',
    })
      .then((res) => {
        let filtered = res.cards;
        // Client-side filter for multi-color selection
        if (colorFilters.size > 1) {
          filtered = filtered.filter((card) => {
            const cardColors = card.colors?.length ? card.colors : card.color ? [card.color] : [];
            return [...colorFilters].every((c) => cardColors.includes(c));
          });
        }
        setLeaders(filtered);
        setLoading(false);
      })
      .catch(() => {
        setLeaders([]);
        setLoading(false);
      });
  }, [open, debouncedKeyword, colorFilters]);

  return (
    <Modal open={open} onClose={onClose} title="Choose a Leader" size="xl">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-glass-border">
        <Input
          type="text"
          placeholder="Search leaders..."
          value={keyword}
          onChange={(e) => handleKeywordChange(e.target.value)}
          className="!w-64"
          autoFocus
        />
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColorFilters((prev) => {
                const next = new Set(prev);
                if (next.has(c)) next.delete(c);
                else next.add(c);
                return next;
              })}
              className={`w-7 h-7 rounded-full border-2 transition-all ${
                colorFilters.has(c) ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
              style={{ backgroundColor: COLOR_MAP[c] }}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Leader Grid */}
      <div>
        {loading ? (
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-surface-2 rounded-lg animate-pulse">
                <div className="aspect-[3/4] bg-surface-3 rounded-t-lg" />
                <div className="p-2 space-y-1">
                  <div className="h-3 bg-surface-3 rounded w-3/4" />
                  <div className="h-2 bg-surface-3 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : leaders.length === 0 ? (
          <div className="text-center text-text-muted py-12">
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
                  onMouseEnter={(e) => showTooltip(leader, e)}
                  onMouseLeave={hideTooltip}
                  className="bg-surface-2 rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-105 hover:ring-2 hover:ring-op-ocean glass-hover"
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
                    <p className="text-xs text-text-primary truncate">{leader.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-text-muted">{leader.id}</span>
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

      {/* Hover Tooltip */}
      {tooltip && <CardTooltip tooltip={tooltip} />}
    </Modal>
  );
}
