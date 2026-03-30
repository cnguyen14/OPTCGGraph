import { useState, useEffect, useCallback, useRef } from 'react';
import type { Card, DeckEntry } from '../types';
import { fetchCard } from '../lib/api';

const STORAGE_KEY = 'optcg-deck-draft';
const MAX_DECK_SIZE = 50;
const MAX_COPIES = 4;

interface StoredDeck {
  leaderId: string | null;
  entries: { cardId: string; quantity: number }[];
}

export function useDeckState() {
  const [leader, setLeader] = useState<Card | null>(null);
  const [entries, setEntries] = useState<Map<string, DeckEntry>>(new Map());
  const [hydrating, setHydrating] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalCards = Array.from(entries.values()).reduce((sum, e) => sum + e.quantity, 0);
  const totalPrice = Array.from(entries.values()).reduce(
    (sum, e) => sum + (e.card.market_price || 0) * e.quantity,
    0,
  );

  // Build cost curve data
  const costCurve: Record<number, number> = {};
  for (const { card, quantity } of entries.values()) {
    if (card.cost != null) {
      costCurve[card.cost] = (costCurve[card.cost] || 0) + quantity;
    }
  }

  // Persistence: save to localStorage (debounced)
  const saveDeck = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const stored: StoredDeck = {
        leaderId: leader?.id ?? null,
        entries: Array.from(entries.entries()).map(([cardId, e]) => ({
          cardId,
          quantity: e.quantity,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }, 500);
  }, [leader, entries]);

  useEffect(() => {
    if (!hydrating) saveDeck();
  }, [leader, entries, hydrating, saveDeck]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setHydrating(false);
      return;
    }

    try {
      const stored: StoredDeck = JSON.parse(raw);
      const loadDeck = async () => {
        // Load leader
        if (stored.leaderId) {
          try {
            const leaderCard = await fetchCard(stored.leaderId);
            setLeader(leaderCard);
          } catch {
            // Leader not found, skip
          }
        }

        // Load deck entries
        const newEntries = new Map<string, DeckEntry>();
        for (const { cardId, quantity } of stored.entries) {
          try {
            const card = await fetchCard(cardId);
            newEntries.set(cardId, { card, quantity });
          } catch {
            // Card not found, skip
          }
        }
        setEntries(newEntries);
        setHydrating(false);
      };

      loadDeck();
    } catch {
      setHydrating(false);
    }
  }, []);

  const addCard = useCallback((card: Card) => {
    setEntries((prev) => {
      const currentTotal = Array.from(prev.values()).reduce((s, e) => s + e.quantity, 0);
      if (currentTotal >= MAX_DECK_SIZE) return prev;

      const existing = prev.get(card.id);
      if (existing && existing.quantity >= MAX_COPIES) return prev;

      const next = new Map(prev);
      if (existing) {
        next.set(card.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(card.id, { card, quantity: 1 });
      }
      return next;
    });
  }, []);

  const removeCard = useCallback((cardId: string) => {
    setEntries((prev) => {
      const existing = prev.get(cardId);
      if (!existing) return prev;

      const next = new Map(prev);
      if (existing.quantity <= 1) {
        next.delete(cardId);
      } else {
        next.set(cardId, { ...existing, quantity: existing.quantity - 1 });
      }
      return next;
    });
  }, []);

  const clearDeck = useCallback(() => {
    setEntries(new Map());
  }, []);

  const getQuantity = useCallback(
    (cardId: string) => entries.get(cardId)?.quantity ?? 0,
    [entries],
  );

  const selectLeader = useCallback((card: Card) => {
    setLeader(card);
  }, []);

  const clearLeader = useCallback(() => {
    setLeader(null);
  }, []);

  const bulkReplace = useCallback((removes: string[], adds: Card[]) => {
    setEntries((prev) => {
      const next = new Map(prev);
      // Remove one copy of each remove ID
      for (const rid of removes) {
        const existing = next.get(rid);
        if (existing) {
          if (existing.quantity <= 1) {
            next.delete(rid);
          } else {
            next.set(rid, { ...existing, quantity: existing.quantity - 1 });
          }
        }
      }
      // Add one copy of each add card
      for (const card of adds) {
        const existing = next.get(card.id);
        if (existing) {
          if (existing.quantity < MAX_COPIES) {
            next.set(card.id, { ...existing, quantity: existing.quantity + 1 });
          }
        } else {
          next.set(card.id, { card, quantity: 1 });
        }
      }
      return next;
    });
  }, []);

  return {
    leader,
    entries,
    totalCards,
    totalPrice,
    costCurve,
    hydrating,
    addCard,
    removeCard,
    clearDeck,
    getQuantity,
    selectLeader,
    clearLeader,
    bulkReplace,
  };
}

export type DeckStateReturn = ReturnType<typeof useDeckState>;
