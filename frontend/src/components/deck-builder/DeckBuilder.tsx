import { useState } from 'react';
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

type ViewMode = 'build' | 'map';

interface Props {
  onCardSelect: (card: Card) => void;
  deckState: DeckStateReturn;
}

export default function DeckBuilder({ onCardSelect, deckState }: Props) {
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
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading deck...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: Leader + Stats + View Toggle + Actions */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Leader Card */}
          {leader ? (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="flex items-center gap-3 min-w-0 cursor-pointer"
                onMouseEnter={(e) => showTooltip(leader, e)}
                onMouseLeave={hideTooltip}
              >
                {leader.image_small ? (
                  <img
                    src={leader.image_small}
                    alt={leader.name}
                    className="w-12 h-16 object-cover rounded-md shadow-lg border border-gray-700"
                  />
                ) : (
                  <div className="w-12 h-16 rounded-md flex items-center justify-center bg-gray-700">
                    <span className="text-white text-[8px]">{leader.id}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{leader.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-gray-500 font-mono">{leader.id}</span>
                    {(leader.colors?.length ? leader.colors : leader.color ? [leader.color] : []).map((c) => (
                      <span
                        key={c}
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: ({ Red: '#ef4444', Blue: '#3b82f6', Green: '#22c55e', Purple: '#a855f7', Black: '#6b7280', Yellow: '#eab308' })[c] ?? '#6b7280' }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowLeaderPicker(true)}
                className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 hover:bg-gray-800 transition-colors"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex-1">
              <button
                onClick={() => setShowLeaderPicker(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Choose a Leader
              </button>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={() => setViewMode('build')}
              className={`px-3 py-1.5 rounded-l text-xs border border-gray-700 transition-colors ${
                viewMode === 'build' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Build
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 rounded-r text-xs border border-gray-700 transition-colors ${
                viewMode === 'map' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Deck Map
            </button>
          </div>

          {/* Collapse/Expand Card Pool */}
          {viewMode === 'build' && (
            <button
              onClick={() => setCardPoolCollapsed(prev => !prev)}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors flex items-center gap-1 shrink-0"
            >
              <svg
                className={`w-3 h-3 transition-transform ${cardPoolCollapsed ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {cardPoolCollapsed ? 'Show Cards' : 'Hide Cards'}
            </button>
          )}

          {/* Saved deck name */}
          {currentDeckName && (
            <span className="text-[11px] text-blue-400 bg-blue-900/20 border border-blue-700/30 rounded px-2 py-1 truncate max-w-[140px] shrink-0">
              {currentDeckName}
            </span>
          )}

          {/* Deck Stats */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-white">{totalCards}<span className="text-gray-500 text-sm font-normal">/50</span></p>
              <p className="text-[10px] text-gray-500 uppercase">Cards</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-400">${totalPrice.toFixed(2)}</p>
              <p className="text-[10px] text-gray-500 uppercase">Price</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowLibrary(true)}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors"
            >
              My Decks
            </button>
            {(leader || totalCards > 0) && (
              <button
                onClick={() => setShowSaveModal(true)}
                className="text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded px-2.5 py-1.5 transition-colors"
              >
                {currentDeckId ? 'Save' : 'Save Deck'}
              </button>
            )}
            {leader && (
              <button
                onClick={clearLeader}
                className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors"
              >
                Reset Leader
              </button>
            )}
            {totalCards > 0 && (
              <button
                onClick={clearDeck}
                className="text-xs text-red-400 hover:text-red-300 border border-gray-700 rounded px-2.5 py-1.5 hover:bg-gray-800 transition-colors"
              >
                Clear Deck
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'build' ? (
        <div className="flex-1 flex overflow-hidden">
          {!cardPoolCollapsed && (
            <CardPool
              leader={leader}
              getQuantity={getQuantity}
              onAddCard={addCard}
              onCardSelect={onCardSelect}
            />
          )}
          {cardPoolCollapsed && (
            <button
              onClick={() => setCardPoolCollapsed(false)}
              className="w-10 shrink-0 bg-gray-900 border-r border-gray-800 flex items-center justify-center hover:bg-gray-800 transition-colors group"
              title="Show card selection"
            >
              <svg className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
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
        <DeckMap
          leader={leader}
          entries={entries}
          onCardSelect={onCardSelect}
        />
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
