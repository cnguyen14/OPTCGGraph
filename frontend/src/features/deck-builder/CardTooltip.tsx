import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../../types';
import { renderAbility } from '../../lib/renderAbility';

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

interface TooltipState {
  card: Card;
  x: number;
  y: number;
  flipUp: boolean;
  flipLeft: boolean;
}

export function useCardTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((card: Card, event: React.MouseEvent) => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }

    const tooltipW = 320;
    const tooltipH = 360;
    const cx = event.clientX;
    const cy = event.clientY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const flipLeft = vw - cx < tooltipW + 20;
    const flipUp = vh - cy < tooltipH;

    const x = flipLeft ? Math.max(4, cx - tooltipW - 10) : cx + 15;
    const y = flipUp ? cy - 10 : cy + 15;

    setTooltip({ card, x, y, flipUp, flipLeft });
  }, []);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setTooltip(null), 80);
  }, []);

  return { tooltip, show, hide };
}

interface Props {
  tooltip: TooltipState;
}

export default function CardTooltip({ tooltip }: Props) {
  const { card: c, x, y, flipUp } = tooltip;
  const colors = c.colors?.length ? c.colors : c.color ? [c.color] : [];

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none w-80 shadow-2xl rounded-[var(--radius-glass-lg)] border border-glass-border-hover overflow-hidden"
      style={{
        left: x,
        top: y,
        transform: flipUp ? 'translateY(-100%)' : undefined,
        background: 'rgba(30, 32, 45, 0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Map texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.06] bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: 'url(/images/op-world-map.jpg)' }}
      />
      <div className="relative p-4">
      <div className="flex gap-3">
        {c.image_small && (
          <img src={c.image_small} alt="" className="w-24 h-[134px] rounded-lg object-cover shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-bold leading-tight">{c.name}</p>
          <p className="text-gray-400 text-[11px] mt-0.5">{c.id} &middot; {c.rarity} &middot; {c.card_type}</p>

          {/* Stats */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {c.cost !== null && <span className="bg-blue-900/60 text-blue-300 rounded px-1.5 py-0.5 text-[10px]">Cost {c.cost}</span>}
            {c.power !== null && <span className="bg-red-900/60 text-red-300 rounded px-1.5 py-0.5 text-[10px]">{c.power} PWR</span>}
            {c.counter !== null && c.counter > 0 && <span className="bg-green-900/60 text-green-300 rounded px-1.5 py-0.5 text-[10px]">+{c.counter} CTR</span>}
          </div>

          {/* Colors & Families */}
          {colors.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {colors.map(col => (
                <span key={col} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: (COLOR_MAP[col] ?? '#374151') + '30', color: COLOR_MAP[col] ?? '#9ca3af' }}>{col}</span>
              ))}
            </div>
          )}
          {c.families?.length > 0 && (
            <p className="text-text-muted text-[10px] mt-1 truncate">{c.families.join(', ')}</p>
          )}
        </div>
      </div>

      {/* Keywords */}
      {c.keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-glass-border">
          {c.keywords.map(kw => (
            <span key={kw} className="bg-purple-900/40 text-purple-300 rounded px-1.5 py-0.5 text-[10px]">{kw}</span>
          ))}
        </div>
      )}

      {/* Ability */}
      {c.ability && (
        <div className="text-text-secondary text-[10px] mt-2 pt-2 border-t border-glass-border leading-relaxed">
          {renderAbility(c.ability, true)}
        </div>
      )}

      {/* Trigger Effect */}
      {c.trigger_effect && (
        <div className="text-text-secondary text-[10px] mt-1 leading-relaxed">
          <span className="text-amber-400 font-semibold">Trigger: </span>
          {renderAbility(c.trigger_effect, true)}
        </div>
      )}

      {/* Footer */}
      {c.market_price !== null && (
        <div className="mt-2 pt-2 border-t border-glass-border text-[10px] text-right">
          <span className="text-green-400">${c.market_price.toFixed(2)}</span>
        </div>
      )}
      </div>
    </div>,
    document.body,
  );
}
