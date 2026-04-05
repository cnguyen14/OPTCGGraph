import { useState, useEffect, useCallback, useRef } from 'react';
import { useDeckState } from './hooks/useDeckState';
import SettingsPage from './features/settings/SettingsPage';
import CardBrowser from './features/cards/CardBrowser';
import DeckBuilder from './features/deck-builder/DeckBuilder';
import MetaExplorer from './features/meta/MetaExplorer';
import CardDetail from './features/cards/CardDetail';
import CardListModal from './features/cards/CardListModal';
import DeckSwapModal from './features/cards/DeckSwapModal';
import type { SwapSuggestion } from './features/cards/DeckSwapModal';
import FloatingChat from './features/chat/FloatingChat';
import SimulatorPage from './features/simulator/SimulatorPage';
import AnalyticsPage from './features/analytics/AnalyticsPage';
import MyDecksPage from './features/my-decks/MyDecksPage';
import AppLayout from './layouts/AppLayout';
import LandingPage from './pages/LandingPage';
import { PageTransition } from './components/ui';
import { fetchCard, getClientId } from './lib/api';
import type { Card } from './types';

type Tab = 'landing' | 'cards' | 'deck' | 'mydecks' | 'meta' | 'simulator' | 'analytics' | 'settings';

const APP_TABS: Tab[] = ['cards', 'deck', 'mydecks', 'meta', 'simulator', 'analytics', 'settings'];

function getTabFromHash(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'graph') return 'cards';
  if (hash === '' || hash === 'landing') return 'landing';
  return APP_TABS.includes(hash as Tab) ? (hash as Tab) : 'landing';
}

function App() {
  const [activeTab, setActiveTabState] = useState<Tab>(getTabFromHash);

  const setActiveTab = useCallback((tab: string) => {
    const validTab = tab as Tab;
    setActiveTabState(validTab);
    window.location.hash = validTab === 'landing' ? '' : validTab;
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
  const [chatOpen, setChatOpen] = useState(false);
  const [cardListModal, setCardListModal] = useState<{ cardIds: string[]; title: string } | null>(null);
  const [swapSuggestions, setSwapSuggestions] = useState<SwapSuggestion[] | null>(null);

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
    if (update.action === 'add_card_to_deck' && update.payload) {
      const { card_ids } = update.payload as { card_ids?: string[] };
      if (card_ids && card_ids.length > 0) {
        for (const id of card_ids) {
          fetchCard(id).then((card) => deckState.addCard(card)).catch(() => {});
        }
      }
    }
    if (update.action === 'remove_card_from_deck' && update.payload) {
      const { card_ids, remove_all } = update.payload as { card_ids?: string[]; remove_all?: boolean };
      if (card_ids && card_ids.length > 0) {
        for (const id of card_ids) {
          if (remove_all) {
            // Remove all copies
            const qty = deckState.getQuantity(id);
            for (let i = 0; i < qty; i++) deckState.removeCard(id);
          } else {
            deckState.removeCard(id);
          }
        }
      }
    }
    if (update.action === 'show_card_list' && update.payload) {
      const { card_ids, title } = update.payload as { card_ids?: string[]; title?: string };
      if (card_ids && card_ids.length > 0) {
        setCardListModal({ cardIds: card_ids, title: title || `Cards (${card_ids.length})` });
      }
    }
    if (update.action === 'show_card_detail' && update.payload) {
      const { card_id } = update.payload as { card_id?: string };
      if (card_id) {
        setCardListModal({ cardIds: [card_id], title: 'Card Detail' });
      }
    }
    if (update.action === 'show_swap_suggestions' && update.payload) {
      const { swaps } = update.payload as { swaps?: SwapSuggestion[] };
      if (swaps && swaps.length > 0) {
        setSwapSuggestions(swaps);
      }
    }
  };

  // Transition between landing ↔ app
  const [landingExit, setLandingExit] = useState(false);
  const [showLanding, setShowLanding] = useState(activeTab === 'landing');
  const landingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleLandingNavigate = useCallback((tab: string) => {
    setLandingExit(true);
    clearTimeout(landingTimerRef.current);
    landingTimerRef.current = setTimeout(() => {
      setShowLanding(false);
      setLandingExit(false);
      setActiveTab(tab);
    }, 400);
  }, [setActiveTab]);

  // When navigating back to landing
  useEffect(() => {
    if (activeTab === 'landing') {
      setShowLanding(true);
    }
  }, [activeTab]);

  useEffect(() => {
    return () => clearTimeout(landingTimerRef.current);
  }, []);

  // Landing page — full-screen with exit transition
  if (showLanding || activeTab === 'landing') {
    return (
      <div className={landingExit ? 'landing-exit' : 'landing-enter'}>
        <LandingPage onNavigate={handleLandingNavigate} />
      </div>
    );
  }

  return (
    <AppLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      chatSidebar={
        <FloatingChat
          sessionId={sessionId}
          onSessionId={setSessionId}
          clientId={getClientId()}
          leaderId={deckState.leader?.id}
          deckCardIds={deckCardIds.length > 0 ? deckCardIds : undefined}
          onUiUpdate={handleUiUpdate}
          onOpenChange={setChatOpen}
        />
      }
    >
      {/* Main Content with page transition */}
      <PageTransition transitionKey={activeTab} className="h-full">
        {activeTab === 'settings' && (
          <SettingsPage />
        )}
        {activeTab === 'cards' && (
          <CardBrowser onCardSelect={setSelectedCard} />
        )}
        {activeTab === 'deck' && (
          <DeckBuilder onCardSelect={setSelectedCard} deckState={deckState} chatOpen={chatOpen} />
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
        {activeTab === 'analytics' && (
          <AnalyticsPage />
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
      </PageTransition>

      {/* Card Detail Slide-over */}
      <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />

      {/* AI Agent Card List Modal */}
      {cardListModal && (
        <CardListModal
          cardIds={cardListModal.cardIds}
          title={cardListModal.title}
          onClose={() => setCardListModal(null)}
          onAddCard={(card) => deckState.addCard(card)}
          onSwapCard={(add, removeId) => {
            deckState.removeCard(removeId);
            deckState.addCard(add);
          }}
          deckCardIds={deckCardIds}
          deckTotal={deckState.totalCards}
        />
      )}

      {/* AI Agent Swap Suggestions Modal */}
      {swapSuggestions && (
        <DeckSwapModal
          swaps={swapSuggestions}
          onApply={(removes, adds) => deckState.bulkReplace(removes, adds)}
          onClose={() => setSwapSuggestions(null)}
        />
      )}
    </AppLayout>
  );
}

export default App;
