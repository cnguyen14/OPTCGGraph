import { useState, useEffect } from 'react';
import { fetchMetaDecks, fetchMetaDeckDetail, listSavedDecks, loadSavedDeck } from '../../lib/api';
import type { MetaDeckSummary, SavedDeckListItem } from '../../types';
import { GlassCard, Button, Input } from '../../components/ui';

interface SelectedDeck {
  leaderId: string;
  leaderName: string;
  cardIds: string[];
  source: string;
}

interface Props {
  label: string;
  currentDeckLeaderId?: string;
  currentDeckCardIds?: string[];
  onSelect: (deck: SelectedDeck | null) => void;
  selected: SelectedDeck | null;
  bare?: boolean;
}

type TabType = 'saved' | 'tournament';

export default function DeckSelector({
  label,
  currentDeckLeaderId,
  currentDeckCardIds,
  onSelect,
  selected,
  bare,
}: Props) {
  const [tab, setTab] = useState<TabType>('saved');
  const [metaDecks, setMetaDecks] = useState<MetaDeckSummary[]>([]);
  const [savedDecks, setSavedDecks] = useState<SavedDeckListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDeck, setLoadingDeck] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Load both saved and tournament decks on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([
      listSavedDecks().catch(() => [] as SavedDeckListItem[]),
      fetchMetaDecks({ limit: 50, max_placement: 8 }),
    ])
      .then(([saved, meta]) => {
        setSavedDecks(saved);
        setMetaDecks(meta);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSelectMeta = async (deck: MetaDeckSummary) => {
    setLoadingDeck(true);
    try {
      const detail = await fetchMetaDeckDetail(deck.id);
      const cardIds: string[] = [];
      for (const card of detail.cards) {
        for (let i = 0; i < card.count; i++) {
          cardIds.push(card.id);
        }
      }
      const tournamentInfo = deck.tournament?.name ? ` - ${deck.tournament.name}` : '';
      onSelect({
        leaderId: deck.leader_id,
        leaderName: deck.leader_name,
        cardIds,
        source: `${deck.archetype} by ${deck.player_name}${tournamentInfo} #${deck.placement ?? ''}`,
      });
    } catch (err) {
      console.error('Failed to load deck:', err);
    } finally {
      setLoadingDeck(false);
    }
  };

  const handleSelectSaved = async (deck: SavedDeckListItem) => {
    if (!deck.leader_id) return;
    setLoadingDeck(true);
    try {
      const full = await loadSavedDeck(deck.id);
      const cardIds: string[] = [];
      for (const entry of full.entries) {
        for (let i = 0; i < entry.quantity; i++) {
          cardIds.push(entry.card_id);
        }
      }
      onSelect({
        leaderId: full.leader_id ?? '',
        leaderName: deck.name,
        cardIds,
        source: `Saved: ${deck.name}`,
      });
    } catch (err) {
      console.error('Failed to load saved deck:', err);
    } finally {
      setLoadingDeck(false);
    }
  };

  const handleUseCurrentDeck = () => {
    if (currentDeckLeaderId && currentDeckCardIds && currentDeckCardIds.length === 50) {
      onSelect({
        leaderId: currentDeckLeaderId,
        leaderName: 'Your Deck',
        cardIds: currentDeckCardIds,
        source: 'Current deck',
      });
    }
  };

  const filteredMeta = metaDecks.filter(
    (d) =>
      d.leader_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.archetype.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.player_name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredSaved = savedDecks.filter(
    (d) =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.description ?? '').toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const content = (
    <>
      <label className={bare ? 'text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block' : 'text-sm font-semibold text-text-primary mb-3 block'}>{label}</label>

      {selected ? (
        <div className="glass-subtle flex items-center justify-between p-3 rounded-lg">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-text-primary truncate">{selected.leaderName}</div>
            <div className="text-[10px] text-text-secondary truncate">{selected.source}</div>
            <div className="text-[10px] text-text-muted">{selected.cardIds.length} cards</div>
          </div>
          <Button
            onClick={() => onSelect(null)}
            variant="ghost"
            size="sm"
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Use current deck button */}
          {currentDeckLeaderId && currentDeckCardIds && currentDeckCardIds.length === 50 && (
            <button
              onClick={handleUseCurrentDeck}
              className="w-full text-left glass-subtle border-op-ocean/30 p-2.5 rounded-lg hover:bg-op-ocean/10 transition-colors"
            >
              <div className="text-xs font-medium text-op-ocean">Use Your Current Deck</div>
              <div className="text-[10px] text-text-muted">{currentDeckCardIds.length} cards</div>
            </button>
          )}

          {/* Tab toggle */}
          <div className="flex border-b border-glass-border">
            <button
              onClick={() => { setTab('saved'); setSearchTerm(''); }}
              className={`flex-1 text-xs py-1.5 text-center transition-colors border-b-2 ${
                tab === 'saved'
                  ? 'text-op-ocean border-op-ocean'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              My Decks{savedDecks.length > 0 ? ` (${savedDecks.length})` : ''}
            </button>
            <button
              onClick={() => { setTab('tournament'); setSearchTerm(''); }}
              className={`flex-1 text-xs py-1.5 text-center transition-colors border-b-2 ${
                tab === 'tournament'
                  ? 'text-op-ocean border-op-ocean'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              Tournament
            </button>
          </div>

          {/* Search */}
          <Input
            type="text"
            placeholder={tab === 'saved' ? 'Search saved decks...' : 'Search tournament decks...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="text-xs"
          />

          {/* Deck list */}
          <div className="max-h-36 overflow-y-auto space-y-1">
            {loading && <p className="text-xs text-text-muted text-center py-2">Loading...</p>}
            {loadingDeck && <p className="text-xs text-op-ocean text-center py-2">Loading deck...</p>}

            {/* Saved decks tab */}
            {!loading && tab === 'saved' && (
              <>
                {filteredSaved.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => handleSelectSaved(deck)}
                    disabled={loadingDeck || !deck.leader_id || deck.card_count !== 50}
                    className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-2 transition-colors disabled:opacity-40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-text-secondary truncate">{deck.name}</div>
                      {deck.description && (
                        <div className="text-[10px] text-text-muted truncate">{deck.description}</div>
                      )}
                    </div>
                    <span className={`text-[10px] shrink-0 ${deck.card_count === 50 ? 'text-green-400/70' : 'text-yellow-400/70'}`}>
                      {deck.card_count} cards
                    </span>
                  </button>
                ))}
                {filteredSaved.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">
                    {savedDecks.length === 0
                      ? 'No saved decks yet. Build one in Deck Builder!'
                      : 'No matching decks'}
                  </p>
                )}
              </>
            )}

            {/* Tournament decks tab */}
            {!loading && tab === 'tournament' && (
              <>
                {filteredMeta.map((deck, i) => (
                  <button
                    key={`${deck.id}-${i}`}
                    onClick={() => handleSelectMeta(deck)}
                    disabled={loadingDeck}
                    className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-2 transition-colors disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-text-secondary truncate">{deck.leader_name}</div>
                      <div className="text-[10px] text-text-muted truncate">
                        {deck.archetype} by {deck.player_name}
                        {deck.tournament?.name ? ` — ${deck.tournament.name}` : ''}
                      </div>
                    </div>
                    {deck.placement && (
                      <span className="text-[10px] text-op-gold/70 shrink-0">
                        #{deck.placement}
                      </span>
                    )}
                  </button>
                ))}
                {filteredMeta.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-2">No decks found</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (bare) {
    return <div>{content}</div>;
  }

  return (
    <GlassCard className="p-4">
      {content}
    </GlassCard>
  );
}

export type { SelectedDeck };
