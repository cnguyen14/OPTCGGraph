import { useState, useEffect } from 'react';
import { fetchMetaDecks, fetchMetaDeckDetail, listSavedDecks, loadSavedDeck } from '../../lib/api';
import type { MetaDeckSummary, SavedDeckListItem } from '../../types';

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
  onSelect: (deck: SelectedDeck) => void;
  selected: SelectedDeck | null;
}

type TabType = 'saved' | 'tournament';

export default function DeckSelector({
  label,
  currentDeckLeaderId,
  currentDeckCardIds,
  onSelect,
  selected,
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

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{label}</h3>

      {selected ? (
        <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
          <div>
            <div className="text-sm font-medium text-white">{selected.leaderName}</div>
            <div className="text-[11px] text-gray-400">{selected.source}</div>
            <div className="text-[10px] text-gray-500">{selected.cardIds.length} cards</div>
          </div>
          <button
            onClick={() => onSelect(null as unknown as SelectedDeck)}
            className="text-xs text-gray-400 hover:text-red-400 px-2 py-1"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Use current deck button */}
          {currentDeckLeaderId && currentDeckCardIds && currentDeckCardIds.length === 50 && (
            <button
              onClick={handleUseCurrentDeck}
              className="w-full text-left bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 hover:bg-blue-900/30 transition-colors"
            >
              <div className="text-xs font-medium text-blue-400">Use Your Current Deck</div>
              <div className="text-[10px] text-gray-400">{currentDeckCardIds.length} cards</div>
            </button>
          )}

          {/* Tab toggle */}
          <div className="flex border-b border-gray-700/50">
            <button
              onClick={() => { setTab('saved'); setSearchTerm(''); }}
              className={`flex-1 text-xs py-1.5 text-center transition-colors border-b-2 ${
                tab === 'saved'
                  ? 'text-blue-400 border-blue-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              My Decks{savedDecks.length > 0 ? ` (${savedDecks.length})` : ''}
            </button>
            <button
              onClick={() => { setTab('tournament'); setSearchTerm(''); }}
              className={`flex-1 text-xs py-1.5 text-center transition-colors border-b-2 ${
                tab === 'tournament'
                  ? 'text-blue-400 border-blue-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              Tournament Decks
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder={tab === 'saved' ? 'Search saved decks...' : 'Search tournament decks...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-600/50"
          />

          {/* Deck list */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {loading && <p className="text-xs text-gray-500 text-center py-2">Loading...</p>}
            {loadingDeck && <p className="text-xs text-blue-400 text-center py-2">Loading deck...</p>}

            {/* Saved decks tab */}
            {!loading && tab === 'saved' && (
              <>
                {filteredSaved.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => handleSelectSaved(deck)}
                    disabled={loadingDeck || !deck.leader_id || deck.card_count !== 50}
                    className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-800/50 transition-colors disabled:opacity-40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-300 truncate">{deck.name}</div>
                      {deck.description && (
                        <div className="text-[10px] text-gray-500 truncate">{deck.description}</div>
                      )}
                    </div>
                    <span className={`text-[10px] shrink-0 ${deck.card_count === 50 ? 'text-green-400/70' : 'text-yellow-400/70'}`}>
                      {deck.card_count} cards
                    </span>
                  </button>
                ))}
                {filteredSaved.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-4">
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
                {filteredMeta.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => handleSelectMeta(deck)}
                    disabled={loadingDeck}
                    className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-800/50 transition-colors disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-300 truncate">{deck.leader_name}</div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {deck.archetype} by {deck.player_name}
                        {deck.tournament?.name ? ` — ${deck.tournament.name}` : ''}
                      </div>
                    </div>
                    {deck.placement && (
                      <span className="text-[10px] text-yellow-400/70 shrink-0">
                        #{deck.placement}
                      </span>
                    )}
                  </button>
                ))}
                {filteredMeta.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-2">No decks found</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type { SelectedDeck };
