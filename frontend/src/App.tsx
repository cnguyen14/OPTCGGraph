import { useState } from 'react';
import GraphExplorer from './components/GraphExplorer';
import CardBrowser from './components/CardBrowser';
import DeckBuilder from './components/deck-builder/DeckBuilder';
import AIChat from './components/AIChat';
import CardDetail from './components/CardDetail';
import type { Card } from './types';

type Tab = 'graph' | 'cards' | 'deck' | 'chat';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('graph');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'graph', label: 'Graph Explorer' },
    { key: 'cards', label: 'Cards' },
    { key: 'deck', label: 'Deck Builder' },
    { key: 'chat', label: 'AI Chat' },
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">OPTCG Knowledge Graph</h1>
          <span className="text-xs text-gray-500 bg-gray-800 rounded px-2 py-0.5">v0.1</span>
        </div>
        <nav className="flex gap-1">
          {tabs.map(tab => (
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
          <DeckBuilder onCardSelect={setSelectedCard} />
        )}
        {activeTab === 'chat' && (
          <div className="h-full p-4">
            <AIChat sessionId={sessionId} onSessionId={setSessionId} />
          </div>
        )}
      </main>

      {/* Card Detail Slide-over */}
      <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}

export default App;
