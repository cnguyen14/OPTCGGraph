import { useState, useEffect } from 'react';
import { validateDeck, suggestFixes, fetchCard } from '../../lib/api';
import type { Card, DeckEntry, ValidationReport, Suggestion } from '../../types';
import { Modal, Button, Spinner } from '../../components/ui';

type Phase = 'validating' | 'results' | 'suggesting' | 'suggestions' | 'applying' | 'done';

interface Props {
  open: boolean;
  leader: Card;
  entries: Map<string, DeckEntry>;
  onApply: (removes: string[], adds: Card[]) => void;
  onClose: () => void;
}

export default function DeckValidationModal({ open, leader, entries, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('validating');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [finalReport, setFinalReport] = useState<ValidationReport | null>(null);

  // Build card_ids from entries (respecting quantities)
  const cardIds: string[] = [];
  entries.forEach((entry) => {
    for (let i = 0; i < entry.quantity; i++) {
      cardIds.push(entry.card.id);
    }
  });

  // Auto-validate on open
  useEffect(() => {
    if (!open) return;
    setPhase('validating');
    setReport(null);
    setSuggestions([]);
    setSelected(new Set());
    setError('');
    setFinalReport(null);

    validateDeck(leader.id, cardIds)
      .then((r) => { setReport(r); setPhase('results'); })
      .catch((e) => { setError(String(e)); setPhase('results'); });
  }, [open]);

  const handleSuggestFixes = async () => {
    setPhase('suggesting');
    try {
      const res = await suggestFixes(leader.id, cardIds);
      setSuggestions(res.suggestions || []);
      // Auto-select all rule fixes
      const autoSelect = new Set<number>();
      res.suggestions?.forEach((s: Suggestion, i: number) => {
        if (s.type === 'rule_fix') autoSelect.add(i);
      });
      setSelected(autoSelect);
      setPhase('suggestions');
    } catch (e) {
      setError(String(e));
      setPhase('results');
    }
  };

  const toggleSuggestion = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApply = async () => {
    setPhase('applying');
    const removes: string[] = [];
    const addIds: string[] = [];

    for (const idx of selected) {
      const s = suggestions[idx];
      if (s) {
        removes.push(s.remove.id);
        addIds.push(s.add.id);
      }
    }

    // Fetch full card data for adds
    const adds: Card[] = [];
    for (const cid of addIds) {
      try {
        const card = await fetchCard(cid);
        adds.push(card);
      } catch { /* skip */ }
    }

    onApply(removes, adds);

    // Re-validate with new deck
    const newIds = [...cardIds];
    for (const rid of removes) {
      const idx = newIds.indexOf(rid);
      if (idx >= 0) newIds.splice(idx, 1);
    }
    for (const card of adds) {
      newIds.push(card.id);
    }

    try {
      const newReport = await validateDeck(leader.id, newIds);
      setFinalReport(newReport);
    } catch { /* ignore */ }
    setPhase('done');
  };

  const hasIssues = report && (!report.is_legal || report.stats.warning > 0);

  return (
    <Modal open={open} onClose={onClose} title="Deck Validation" size="lg">
      <p className="text-xs text-text-muted -mt-2 mb-4">{leader.name} ({leader.id}) &middot; {cardIds.length} cards</p>

      <div className="space-y-4">
        {/* Phase: Validating */}
        {phase === 'validating' && (
          <div className="text-center py-12">
            <Spinner size="lg" className="mx-auto mb-3" />
            <p className="text-text-muted">Validating deck...</p>
          </div>
        )}

        {/* Phase: Results */}
        {(phase === 'results' || phase === 'suggesting' || phase === 'suggestions' || phase === 'applying' || phase === 'done') && report && (
          <>
            {/* Summary badge */}
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
              report.is_legal
                ? report.stats.warning === 0 ? 'bg-green-900/50 text-green-300 border border-green-800' : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'
                : 'bg-red-900/30 text-red-300 border border-red-800'
            }`}>
              {report.summary}
            </div>

            {/* Checks list */}
            <div className="space-y-1.5">
              {report.checks.map((check) => {
                const icon = check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '✗' : '⚠';
                const color = check.status === 'PASS' ? 'text-green-400' : check.status === 'FAIL' ? 'text-red-400' : 'text-yellow-400';
                return (
                  <div key={check.name} className="flex items-start gap-2 text-sm">
                    <span className={`${color} font-bold w-4 shrink-0`}>{icon}</span>
                    <div>
                      <span className="text-text-secondary font-medium">{check.name}</span>
                      <span className="text-text-muted ml-2">{check.message}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Phase: Suggestions */}
        {phase === 'suggestions' && suggestions.length > 0 && (
          <div className="space-y-3 mt-4">
            <h3 className="text-text-primary font-semibold text-sm">Suggested Replacements</h3>
            <p className="text-xs text-text-muted">Select which swaps to apply. Rule fixes are auto-selected.</p>

            {suggestions.map((s, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selected.has(i)
                    ? s.priority === 'high' ? 'bg-red-900/20 border-red-700' : 'bg-op-ocean/10 border-op-ocean/40'
                    : 'bg-surface-2 border-glass-border hover:bg-surface-3'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggleSuggestion(i)}
                  className="mt-1 accent-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      s.priority === 'high' ? 'bg-red-900 text-red-300' : s.priority === 'medium' ? 'bg-yellow-900 text-yellow-300' : 'bg-surface-3 text-text-secondary'
                    }`}>
                      {s.priority}
                    </span>
                    <span className="text-xs text-text-muted">{s.check_name}</span>
                  </div>

                  <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 text-sm">
                    {/* Remove */}
                    <div className="bg-red-900/20 rounded p-2">
                      <div className="text-red-300 font-medium truncate">{s.remove.name}</div>
                      <div className="text-red-400/70 text-xs">{s.remove.id}</div>
                      <div className="text-text-muted text-xs mt-0.5">{s.remove.reason}</div>
                    </div>

                    <span className="text-text-muted text-lg">→</span>

                    {/* Add */}
                    <div className="bg-green-900/20 rounded p-2">
                      <div className="text-green-300 font-medium truncate">{s.add.name}</div>
                      <div className="text-green-400/70 text-xs">{s.add.id}</div>
                      <div className="text-text-muted text-xs mt-0.5">{s.add.benefit}</div>
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {phase === 'suggestions' && suggestions.length === 0 && (
          <p className="text-text-muted text-sm text-center py-4">No suggestions available -- deck looks good!</p>
        )}

        {/* Phase: Applying */}
        {phase === 'applying' && (
          <div className="text-center py-8">
            <Spinner size="lg" className="mx-auto mb-3" />
            <p className="text-text-muted">Applying changes and re-validating...</p>
          </div>
        )}

        {/* Phase: Done */}
        {phase === 'done' && finalReport && (
          <div className="mt-4">
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
              finalReport.is_legal
                ? 'bg-green-900/50 text-green-300 border border-green-800'
                : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'
            }`}>
              After fixes: {finalReport.summary}
            </div>
            <p className="text-text-muted text-xs mt-2">
              {selected.size} replacement(s) applied. You can close this modal and continue editing.
            </p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-glass-border">
        {phase === 'results' && hasIssues && (
          <Button variant="primary" size="sm" onClick={handleSuggestFixes}>
            Suggest Fixes
          </Button>
        )}

        {phase === 'suggestions' && selected.size > 0 && (
          <Button variant="success" size="sm" onClick={handleApply}>
            Apply {selected.size} Fix{selected.size > 1 ? 'es' : ''}
          </Button>
        )}

        <Button variant="secondary" size="sm" onClick={onClose}>
          {phase === 'done' ? 'Done' : 'Close'}
        </Button>
      </div>
    </Modal>
  );
}
