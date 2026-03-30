import { useState } from 'react';
import { useDeckState } from './hooks/useDeckState';
import GraphExplorer from './components/GraphExplorer';
import CardBrowser from './components/CardBrowser';
import DeckBuilder from './components/deck-builder/DeckBuilder';
import CardDetail from './components/CardDetail';
import FloatingChat from './components/FloatingChat';
import type { Card } from './types';

type Tab = 'graph' | 'cards' | 'deck';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('graph');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Deck state lifted to App so FloatingChat can access it
  const deckState = useDeckState();

  // Build deck card IDs for chat context
  const deckCardIds: string[] = [];
  deckState.entries.forEach((entry) => {
    for (let i = 0; i < entry.quantity; i++) {
      deckCardIds.push(entry.card.id);
    }
  });

  const handleUiUpdate = (update: { action: string; payload: Record<string, unknown> }) => {
    if (update.action === 'update_deck_list') {
      setActiveTab('deck');
    }
    console.log('AG-UI update:', update);
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
            { key: 'graph' as Tab, label: 'Graph Explorer' },
            { key: 'cards' as Tab, label: 'Cards' },
            { key: 'deck' as Tab, label: 'Deck Builder' },
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
      <main className="flex-1 overflow-hidden">
        {activeTab === 'graph' && (
          <GraphExplorer onCardSelect={setSelectedCard} />
        )}
        {activeTab === 'cards' && (
          <CardBrowser onCardSelect={setSelectedCard} />
        )}
        {activeTab === 'deck' && (
          <DeckBuilder onCardSelect={setSelectedCard} deckState={deckState} />
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
