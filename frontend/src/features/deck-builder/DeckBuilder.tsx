import { useState, useEffect, useRef } from 'react';
import type { DeckStateReturn } from '../../hooks/useDeckState';
import type { Card, SavedDeck } from '../../types';
import LeaderPickerModal from './LeaderPickerModal';
import CardPool from './CardPool';
import DeckPanel from './DeckPanel';
import DeckAnalysis from './DeckAnalysis';
import DeckMap from './DeckMap';
import SaveDeckModal from './SaveDeckModal';
import DeckLibrary from './DeckLibrary';
import CardTooltip, { useCardTooltip } from './CardTooltip';
import { Button, Spinner, Badge } from '../../components/ui';

type ViewMode = 'build' | 'map';

interface Props {
  onCardSelect: (card: Card) => void;
  deckState: DeckStateReturn;
  chatOpen?: boolean;
  onNoSynergyCards?: (cardIds: string[]) => void;
}

export default function DeckBuilder({ onCardSelect, deckState, chatOpen, onNoSynergyCards }: Props) {
  const {
    leader,
    entries,
    totalCards,
    totalPrice,
    costCurve,
    hydrating,
    deckNotes,
    addCard,
    removeCard,
    clearDeck,
    getQuantity,
    selectLeader,
    clearLeader,
    bulkReplace,
  } = deckState;

  const { tooltip, show: showTooltip, hide: hideTooltip } = useCardTooltip();
  const [showLeaderPicker, setShowLeaderPicker] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('build');
  const [cardPoolCollapsed, setCardPoolCollapsed] = useState(false);
  const [highlightedCardIds, setHighlightedCardIds] = useState<string[] | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);
  const [currentDeckName, setCurrentDeckName] = useState<string | null>(null);
  const [currentDeckDescription, setCurrentDeckDescription] = useState<string | null>(null);

  // Auto-collapse CardPool when too many panels are open (DeckAnalysis + Chat both visible)
  const userCollapsed = useRef(false);
  useEffect(() => {
    const tooManyPanels = !!deckNotes && !!chatOpen;
    if (tooManyPanels && !cardPoolCollapsed) {
      userCollapsed.current = false;
      setCardPoolCollapsed(true);
    } else if (!tooManyPanels && cardPoolCollapsed && !userCollapsed.current) {
      setCardPoolCollapsed(false);
    }
  }, [deckNotes, chatOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeckSaved = (_deck: SavedDeck) => {
    // Reset builder for new deck
    deckState.clearLeader();
    deckState.clearDeck();
    setCurrentDeckId(null);
    setCurrentDeckName(null);
    setCurrentDeckDescription(null);
  };

  const handleLoadDeck = (deck: SavedDeck) => {
    const cardIds = deck.entries.flatMap((e) =>
      Array.from({ length: e.quantity }, () => e.card_id),
    );
    if (deck.leader_id) {
      deckState.loadDeckFromIds(deck.leader_id, cardIds);
    }
    if (deck.deck_notes) {
      deckState.setDeckNotes(deck.deck_notes);
    }
    setCurrentDeckId(deck.id);
    setCurrentDeckName(deck.name);
    setCurrentDeckDescription(deck.description);
  };

  if (hydrating) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <div className="text-center">
          <Spinner size="lg" className="mx-auto mb-3" />
          <p className="text-sm">Loading deck...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex gap-3 p-3 overflow-hidden">
      {/* Left Sidebar — Leader + Controls */}
      <div className="glass w-56 shrink-0 overflow-y-auto p-4 space-y-4 flex flex-col">
        {/* Leader */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Leader</label>
          {leader ? (
            <div className="space-y-2">
              <div
                className="cursor-pointer"
                onMouseEnter={(e) => showTooltip(leader, e)}
                onMouseLeave={hideTooltip}
              >
                {leader.image_small ? (
                  <img
                    src={leader.image_small}
                    alt={leader.name}
                    className="w-full aspect-[3/4] object-cover rounded-lg shadow-lg border border-glass-border"
                  />
                ) : (
                  <div className="w-full aspect-[3/4] rounded-lg flex items-center justify-center bg-surface-3">
                    <span className="text-text-primary text-xs">{leader.id}</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-text-primary font-semibold text-xs truncate">{leader.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-text-muted font-mono">{leader.id}</span>
                  {(leader.colors?.length ? leader.colors : leader.color ? [leader.color] : []).map((c) => (
                    <span
                      key={c}
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: ({ Red: '#ef4444', Blue: '#3b82f6', Green: '#22c55e', Purple: '#a855f7', Black: '#6b7280', Yellow: '#eab308' })[c] ?? '#6b7280' }}
                    />
                  ))}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowLeaderPicker(true)} className="w-full">
                Change Leader
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setShowLeaderPicker(true)} className="w-full">
              Choose Leader
            </Button>
          )}
        </div>

        {/* Deck Stats */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Deck Stats</label>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-subtle p-2 rounded-lg text-center">
              <p className="text-base font-bold text-text-primary">{totalCards}<span className="text-text-muted text-xs font-normal">/50</span></p>
              <p className="text-[9px] text-text-muted uppercase">Cards</p>
            </div>
            <div className="glass-subtle p-2 rounded-lg text-center">
              <p className="text-base font-bold text-green-400">${totalPrice.toFixed(2)}</p>
              <p className="text-[9px] text-text-muted uppercase">Price</p>
            </div>
          </div>
        </div>

        {/* Saved deck name */}
        {currentDeckName && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Current Deck</label>
            <Badge variant="blue" className="truncate w-full text-center block">
              {currentDeckName}
            </Badge>
          </div>
        )}

        {/* View Mode */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">View</label>
          <div className="flex gap-0.5">
            <Button
              variant={viewMode === 'build' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('build')}
              className="flex-1 !rounded-r-none"
            >
              Build
            </Button>
            <Button
              variant={viewMode === 'map' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('map')}
              className="flex-1 !rounded-l-none"
            >
              Map
            </Button>
          </div>
        </div>

        {/* Card Pool Toggle */}
        {viewMode === 'build' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { userCollapsed.current = true; setCardPoolCollapsed(prev => !prev); }}
            className="w-full"
          >
            {cardPoolCollapsed ? 'Show Card Pool' : 'Hide Card Pool'}
          </Button>
        )}

        {/* Actions */}
        <div className="space-y-2 mt-auto">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block">Actions</label>
          <Button variant="secondary" size="sm" onClick={() => setShowLibrary(true)} className="w-full">
            My Decks
          </Button>
          {(leader || totalCards > 0) && (
            <Button variant="success" size="sm" onClick={() => setShowSaveModal(true)} className="w-full">
              {currentDeckId ? 'Save' : 'Save Deck'}
            </Button>
          )}
          {leader && (
            <Button variant="ghost" size="sm" onClick={clearLeader} className="w-full">
              Reset Leader
            </Button>
          )}
          {totalCards > 0 && (
            <Button variant="danger" size="sm" onClick={clearDeck} className="w-full">
              Clear Deck
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'build' ? (
        <div className="flex-1 flex gap-3 overflow-hidden min-w-0">
          {!cardPoolCollapsed && (
            <CardPool
              leader={leader}
              getQuantity={getQuantity}
              onAddCard={addCard}
              onCardSelect={onCardSelect}
            />
          )}
          <DeckPanel
            entries={entries}
            totalCards={totalCards}
            totalPrice={totalPrice}
            costCurve={costCurve}
            leader={leader}
            highlightedCardIds={highlightedCardIds}
            onAdd={addCard}
            onRemove={removeCard}
            onCardSelect={onCardSelect}
            onBulkReplace={bulkReplace}
          />
          {deckNotes && (
            <DeckAnalysis notes={deckNotes} onHighlightCards={setHighlightedCardIds} />
          )}
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col">
          <DeckMap
            leader={leader}
            entries={entries}
            onCardSelect={onCardSelect}
            onNoSynergyCards={onNoSynergyCards}
          />
        </div>
      )}

      {/* Leader Picker Modal */}
      <LeaderPickerModal
        open={showLeaderPicker}
        onClose={() => setShowLeaderPicker(false)}
        onSelect={selectLeader}
      />

      {/* Save Deck Modal */}
      <SaveDeckModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSaved={handleDeckSaved}
        leader={leader}
        entries={entries}
        deckNotes={deckNotes}
        existingDeckId={currentDeckId}
        existingName={currentDeckName}
        existingDescription={currentDeckDescription}
      />

      {/* Deck Library Modal */}
      <DeckLibrary
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onLoadDeck={handleLoadDeck}
      />

      {/* Leader Hover Tooltip */}
      {tooltip && <CardTooltip tooltip={tooltip} />}
    </div>
  );
}
