import type { Card } from '../../types';
import { renderAbility } from '../../lib/renderAbility';
import { GlassCard, Badge, IconButton } from '../../components/ui';

interface Props {
  card: Card | null;
  onClose: () => void;
}

export default function CardDetail({ card, onClose }: Props) {
  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex max-w-3xl w-full max-h-[85vh] glass-heavy text-text-primary shadow-2xl rounded-xl overflow-hidden border border-glass-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Card Image */}
        <div className="shrink-0 w-72 bg-surface-base flex items-center justify-center p-4">
          <img
            src={card.image_large || card.image_small}
            alt={card.name}
            className="w-full rounded-lg"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* Right: Card Info */}
        <div className="flex-1 overflow-y-auto p-6">
          <IconButton icon="close" variant="ghost" size="md" onClick={onClose} className="absolute top-4 right-4" />

          {card.banned && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-950/50 border border-red-700/40 text-xs text-red-400 font-medium">
              BANNED — This card is not legal for tournament play
            </div>
          )}

          <h2 className="text-xl font-bold mb-1 pr-8 text-text-primary">{card.name}</h2>
          <p className="text-sm text-text-secondary mb-3">{card.id} &middot; {card.rarity} &middot; {card.card_type}</p>

          <div className="flex gap-2 mb-4 text-sm">
            {card.cost !== null && (
              <GlassCard variant="subtle" className="rounded p-2 text-center min-w-16">
                <div className="text-text-secondary text-xs">Cost</div>
                <div className="text-lg font-bold text-text-primary">{card.cost}</div>
              </GlassCard>
            )}
            {card.power !== null && (
              <GlassCard variant="subtle" className="rounded p-2 text-center min-w-16">
                <div className="text-text-secondary text-xs">Power</div>
                <div className="text-lg font-bold text-text-primary">{card.power}</div>
              </GlassCard>
            )}
            {card.counter !== null && (
              <GlassCard variant="subtle" className="rounded p-2 text-center min-w-16">
                <div className="text-text-secondary text-xs">Counter</div>
                <div className="text-lg font-bold text-text-primary">{card.counter}</div>
              </GlassCard>
            )}
            {card.life && (
              <GlassCard variant="subtle" className="rounded p-2 text-center min-w-16">
                <div className="text-text-secondary text-xs">Life</div>
                <div className="text-lg font-bold text-text-primary">{card.life}</div>
              </GlassCard>
            )}
          </div>

          {card.colors.length > 0 && (
            <div className="mb-3">
              <span className="text-text-secondary text-sm">Colors: </span>
              {card.colors.map(c => {
                const colorVariant: Record<string, 'red' | 'blue' | 'green' | 'purple' | 'yellow' | 'default'> = {
                  Red: 'red', Blue: 'blue', Green: 'green', Purple: 'purple', Yellow: 'yellow', Black: 'default',
                };
                return <Badge key={c} variant={colorVariant[c] ?? 'default'} className="mr-1">{c}</Badge>;
              })}
            </div>
          )}

          {card.families.length > 0 && (
            <div className="mb-3">
              <span className="text-text-secondary text-sm">Family: </span>
              {card.families.map(f => (
                <Badge key={f} variant="default" className="mr-1">{f}</Badge>
              ))}
            </div>
          )}

          {card.ability && (
            <div className="mb-3">
              <div className="text-text-secondary text-sm mb-1">Ability</div>
              <GlassCard variant="subtle" className="text-sm rounded p-3 leading-relaxed text-text-primary">
                {renderAbility(card.ability)}
              </GlassCard>
            </div>
          )}

          {card.keywords.length > 0 && (
            <div className="mb-3">
              <div className="text-text-secondary text-sm mb-1">Keywords</div>
              <div className="flex flex-wrap gap-1">
                {card.keywords.map(kw => (
                  <Badge key={kw} variant="blue">{kw}</Badge>
                ))}
              </div>
            </div>
          )}

          {(card.market_price || card.inventory_price) && (
            <div className="mt-4 pt-4 border-t border-glass-border">
              <div className="text-text-secondary text-sm mb-1">Pricing</div>
              {card.market_price && <p className="text-sm">Market: <span className="text-green-400">${card.market_price.toFixed(2)}</span></p>}
              {card.inventory_price && <p className="text-sm">Inventory: <span className="text-yellow-400">${card.inventory_price.toFixed(2)}</span></p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
