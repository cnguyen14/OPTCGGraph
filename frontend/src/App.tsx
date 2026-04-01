import { useState, useEffect, useCallback } from 'react';
import { useDeckState } from './hooks/useDeckState';
import SettingsPage from './components/SettingsPage';
import CardBrowser from './components/CardBrowser';
import DeckBuilder from './components/deck-builder/DeckBuilder';
import MetaExplorer from './components/MetaExplorer';
import CardDetail from './components/CardDetail';
import FloatingChat from './components/FloatingChat';
import SimulatorPage from './components/simulator/SimulatorPage';
import MyDecksPage from './components/MyDecksPage';
import type { Card } from './types';

type Tab = 'cards' | 'deck' | 'mydecks' | 'meta' | 'simulator' | 'settings';

const VALID_TABS: Tab[] = ['cards', 'deck', 'mydecks', 'meta', 'simulator', 'settings'];

function getTabFromHash(): Tab {
  const hash = window.location.hash.slice(1);
  // Backward compat: old #graph → cards
  if (hash === 'graph') return 'cards';
  return VALID_TABS.includes(hash as Tab) ? (hash as Tab) : 'cards';
}

function App() {
  const [activeTab, setActiveTabState] = useState<Tab>(getTabFromHash);

  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    window.location.hash = tab;
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTabState(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Deck state lifted to App so FloatingChat can access it
  const deckState = useDeckState();

  // State for pre-selecting a deck in the simulator
  const [simDeck, setSimDeck] = useState<{ leaderId: string; cardIds: string[] } | null>(null);

  // Build deck card IDs for chat context
  const deckCardIds: string[] = [];
  deckState.entries.forEach((entry) => {
    for (let i = 0; i < entry.quantity; i++) {
      deckCardIds.push(entry.card.id);
    }
  });

  const handleUiUpdate = (update: { action: string; payload: Record<string, unknown> }) => {
    if (update.action === 'update_deck_list' && update.payload) {
      const { leader_id, cards } = update.payload as { leader_id?: string; cards?: string[] };
      if (leader_id && cards && cards.length > 0) {
        deckState.loadDeckFromIds(leader_id, cards);
        setActiveTab('deck');
      }
    }
    if (update.action === 'update_deck_notes' && update.payload) {
      const { notes } = update.payload as { notes?: string };
      if (notes) {
        deckState.setDeckNotes(notes);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">OPTCG Knowledge Graph</h1>
          <span className="text-xs text-gray-500 bg-gray-800 rounded px-2 py-0.5">v0.1</span>
        </div>
        <nav className="flex gap-1">
          {[
            { key: 'cards' as Tab, label: 'Cards' },
            { key: 'deck' as Tab, label: 'Deck Builder' },
            { key: 'mydecks' as Tab, label: 'My Decks' },
            { key: 'meta' as Tab, label: 'Meta Explorer' },
            { key: 'simulator' as Tab, label: 'Simulator' },
            { key: 'settings' as Tab, label: 'Settings' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded text-sm transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'settings' && (
          <SettingsPage />
        )}
        {activeTab === 'cards' && (
          <CardBrowser onCardSelect={setSelectedCard} />
        )}
        {activeTab === 'deck' && (
          <DeckBuilder onCardSelect={setSelectedCard} deckState={deckState} />
        )}
        {activeTab === 'mydecks' && (
          <MyDecksPage
            onLoadDeck={(leaderId, cardIds) => {
              deckState.loadDeckFromIds(leaderId, cardIds);
              setActiveTab('deck');
            }}
            onSimulateDeck={(leaderId, cardIds) => {
              setSimDeck({ leaderId, cardIds });
              setActiveTab('simulator');
            }}
            onNewDeck={() => {
              deckState.clearDeck();
              setActiveTab('deck');
            }}
          />
        )}
        {activeTab === 'meta' && (
          <MetaExplorer onCardSelect={setSelectedCard} deckState={deckState} />
        )}
        {activeTab === 'simulator' && (
          <SimulatorPage
            currentDeckLeaderId={simDeck?.leaderId ?? deckState.leader?.id}
            currentDeckCardIds={
              simDeck?.cardIds ??
              (deckCardIds.length === 50 ? deckCardIds : undefined)
            }
          />
        )}
      </main>

      {/* Card Detail Slide-over */}
      <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />

      {/* Floating AI Chat — always visible, aware of deck state */}
      <FloatingChat
        sessionId={sessionId}
        onSessionId={setSessionId}
        leaderId={deckState.leader?.id}
        deckCardIds={deckCardIds.length > 0 ? deckCardIds : undefined}
        onUiUpdate={handleUiUpdate}
      />
    </div>
  );
}

export default App;
