import { useMemo, useState } from 'react';

interface ParsedSection {
  type: 'strategy' | 'decklist' | 'validation' | 'price' | 'general';
  title: string;
  content: string;
  icon: string;
  accent: string;
}

interface ParsedCard {
  qty: string;
  name: string;
  id: string;
  desc: string;
}

function parseNotes(raw: string): { summary: string; sections: ParsedSection[] } {
  const lines = raw.split('\n');
  let summary = '';
  const sections: ParsedSection[] = [];

  let currentSection: ParsedSection | null = null;
  let contentLines: string[] = [];

  function flushSection() {
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      if (currentSection.content) {
        sections.push(currentSection);
      }
    }
    contentLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract summary from first descriptive line
    if (!summary && trimmed.length > 40 && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
      summary = trimmed
        .replace(/\*\*/g, '')
        .replace(/\[.*?\]/g, '')
        .slice(0, 200);
      continue;
    }

    // Detect section headers
    const headerMatch = trimmed.match(/^(?:#{1,3}\s+|\*\*)(.*?)(?:\*\*)?$/);
    const headerText = headerMatch?.[1]?.replace(/\*\*/g, '').trim() ?? '';

    if (headerText && headerText.length > 2 && headerText.length < 60) {
      flushSection();

      const lower = headerText.toLowerCase();
      if (lower.includes('strategy') || lower.includes('how your leader')) {
        currentSection = { type: 'strategy', title: headerText, content: '', icon: '\u{1F3AF}', accent: 'blue' };
      } else if (lower.includes('decklist') || lower.includes('cost')) {
        currentSection = { type: 'decklist', title: headerText, content: '', icon: '\u{1F4CB}', accent: 'purple' };
      } else if (lower.includes('validation') || lower.includes('legal')) {
        currentSection = { type: 'validation', title: headerText, content: '', icon: '\u2705', accent: 'green' };
      } else if (lower.includes('price') || lower.includes('value') || lower.includes('estimated')) {
        currentSection = { type: 'price', title: headerText, content: '', icon: '\u{1F4B0}', accent: 'yellow' };
      } else {
        currentSection = { type: 'general', title: headerText, content: '', icon: '\u{1F4A1}', accent: 'gray' };
      }
    } else if (trimmed.startsWith('\u2705') || trimmed.startsWith('\u2714')) {
      flushSection();
      currentSection = { type: 'validation', title: 'Validation Results', content: '', icon: '\u2705', accent: 'green' };
      contentLines.push(trimmed);
    } else if (trimmed.match(/^total estimated/i) || trimmed.match(/^\*\*total estimated/i)) {
      flushSection();
      currentSection = { type: 'price', title: 'Estimated Value', content: '', icon: '\u{1F4B0}', accent: 'yellow' };
      contentLines.push(trimmed);
    } else {
      contentLines.push(line);
    }
  }
  flushSection();

  if (sections.length === 0 && raw.trim()) {
    sections.push({
      type: 'general',
      title: 'AI Analysis',
      content: raw.trim(),
      icon: '\u{1F916}',
      accent: 'blue',
    });
  }

  return { summary, sections };
}

function parseCardLines(content: string): { cards: ParsedCard[]; other: string[] } {
  const cards: ParsedCard[] = [];
  const other: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Match formats:
    //   "- 4x **Nami** (OP01-016) — searcher"
    //   "4x Nami (OP01-016) — searcher"
    //   "- 4x Nami (OP01-016)"
    //   "**Nami** (OP01-016) x4 — searcher"
    const match = trimmed.match(
      /^[-•*]*\s*(\d+)x\s+\*{0,2}(.+?)\*{0,2}\s+\(([A-Z0-9]+-[A-Z0-9]+)\)\s*(?:[—\-–:]+\s*\*?(.*?)\*?\s*)?$/
    ) ?? trimmed.match(
      /^[-•*]*\s*\*{0,2}(.+?)\*{0,2}\s+\(([A-Z0-9]+-[A-Z0-9]+)\)\s*(?:x(\d+))?\s*(?:[—\-–:]+\s*\*?(.*?)\*?\s*)?$/
    );
    if (match) {
      // First regex: group 1=qty, 2=name, 3=id, 4=desc
      // Second regex: group 1=name, 2=id, 3=qty (optional), 4=desc
      const isFirstFormat = /^\d+$/.test(match[1]) && match[3]?.match(/^[A-Z0-9]+-/);
      if (isFirstFormat) {
        cards.push({
          qty: match[1],
          name: match[2].replace(/\*\*/g, '').trim(),
          id: match[3].trim(),
          desc: (match[4] || '').replace(/\*/g, '').trim(),
        });
      } else {
        cards.push({
          qty: match[3] || '1',
          name: match[1].replace(/\*\*/g, '').trim(),
          id: match[2].trim(),
          desc: (match[4] || '').replace(/\*/g, '').trim(),
        });
      }
    } else if (trimmed && !trimmed.match(/^---+$/)) {
      other.push(trimmed);
    }
  }
  return { cards, other };
}

const ACCENT_COLORS: Record<string, { border: string; bg: string; text: string; badge: string; headerHover: string }> = {
  blue: { border: 'border-blue-700/40', bg: 'bg-blue-950/30', text: 'text-blue-400', badge: 'bg-blue-900/50 text-blue-300', headerHover: 'hover:bg-blue-900/30' },
  purple: { border: 'border-purple-700/40', bg: 'bg-purple-950/30', text: 'text-purple-400', badge: 'bg-purple-900/50 text-purple-300', headerHover: 'hover:bg-purple-900/30' },
  green: { border: 'border-green-700/40', bg: 'bg-green-950/30', text: 'text-green-400', badge: 'bg-green-900/50 text-green-300', headerHover: 'hover:bg-green-900/30' },
  yellow: { border: 'border-yellow-700/40', bg: 'bg-yellow-950/30', text: 'text-yellow-400', badge: 'bg-yellow-900/50 text-yellow-300', headerHover: 'hover:bg-yellow-900/30' },
  gray: { border: 'border-gray-700/40', bg: 'bg-gray-800/30', text: 'text-gray-400', badge: 'bg-gray-700/50 text-gray-300', headerHover: 'hover:bg-gray-700/30' },
};

interface Props {
  notes: string;
  onHighlightCards?: (cardIds: string[] | null) => void;
}

export default function DeckAnalysis({ notes, onHighlightCards }: Props) {
  const { summary, sections } = useMemo(() => parseNotes(notes), [notes]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [activeSection, setActiveSection] = useState<number | null>(null);

  const toggleSection = (idx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Click section header → highlight all cards in that section
  const handleSectionHighlight = (idx: number, cards: ParsedCard[]) => {
    if (activeSection === idx) {
      // Toggle off
      setActiveSection(null);
      onHighlightCards?.(null);
    } else {
      setActiveSection(idx);
      onHighlightCards?.(cards.map(c => c.id));
    }
  };

  return (
    <div className="min-w-[300px] flex-1 flex flex-col glass overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-glass-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-op-ocean/20 flex items-center justify-center text-xs">
            {'\u{1F916}'}
          </div>
          <h3 className="text-text-primary font-semibold text-sm">AI Strategy Guide</h3>
        </div>
        {summary && (
          <p className="text-text-secondary text-[11px] mt-2 leading-relaxed">{summary}</p>
        )}
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {sections.map((section, idx) => {
          const colors = ACCENT_COLORS[section.accent] || ACCENT_COLORS.gray;
          const isCollapsed = collapsed.has(idx);
          const isActive = activeSection === idx;

          // Decklist sections
          if (section.type === 'decklist') {
            const { cards, other } = parseCardLines(section.content);
            return (
              <div key={idx} className={`rounded-lg border ${isActive ? 'border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.15)]' : colors.border} ${colors.bg} overflow-hidden transition-all`}>
                <div className={`flex items-center gap-2 px-3 py-2 transition-all ${isActive ? 'bg-purple-900/20' : ''}`}>
                  <button
                    onClick={() => {
                      if (cards.length > 0) {
                        handleSectionHighlight(idx, cards);
                        // Auto-expand so user sees which cards are highlighted
                        if (collapsed.has(idx)) toggleSection(idx);
                      } else {
                        toggleSection(idx);
                      }
                    }}
                    className={`flex items-center gap-2 flex-1 text-left ${colors.headerHover} rounded px-1 -mx-1 py-0.5 transition-all cursor-pointer`}
                  >
                    <span className="text-sm">{section.icon}</span>
                    <span className={`text-xs font-semibold ${colors.text}`}>{section.title}</span>
                    {cards.length > 0 && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${isActive ? 'bg-purple-600 text-white' : colors.badge}`}>
                        {cards.length} cards
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => toggleSection(idx)}
                    className="p-1 rounded hover:bg-gray-700/50 transition-colors shrink-0"
                  >
                    <svg
                      className={`w-3 h-3 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="px-3 pb-2 space-y-0.5">
                    {other.map((line, i) => (
                      <p key={i} className="text-[11px] text-gray-400 font-medium">{line.replace(/\*\*/g, '')}</p>
                    ))}
                    {cards.map((card, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 py-1 px-1.5 -mx-1.5 rounded cursor-pointer hover:bg-purple-900/30 transition-colors"
                        onClick={() => onHighlightCards?.([card.id])}
                      >
                        <span className="text-[10px] font-bold text-white bg-purple-800/60 rounded w-5 h-5 flex items-center justify-center shrink-0">
                          {card.qty}
                        </span>
                        <span className="text-[11px] text-gray-200 truncate">{card.name}</span>
                        <span className="text-[9px] text-gray-600 shrink-0">{card.id}</span>
                        {card.desc && (
                          <span className="text-[9px] text-purple-400/70 truncate ml-auto">{card.desc}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // Validation sections
          if (section.type === 'validation') {
            const validationLines = section.content.split('\n').filter(l => l.trim());
            const allPassed = section.content.includes('All') && section.content.includes('passed');
            return (
              <div key={idx} className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden`}>
                <button
                  onClick={() => toggleSection(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left ${colors.headerHover} transition-all`}
                >
                  <span className="text-sm">{section.icon}</span>
                  <span className={`text-xs font-semibold ${colors.text} flex-1`}>{section.title}</span>
                  {allPassed && (
                    <span className="text-[10px] rounded-full px-2 py-0.5 bg-green-900/60 text-green-300 font-medium">
                      All Passed
                    </span>
                  )}
                  <svg
                    className={`w-3 h-3 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="px-3 pb-2 space-y-0.5">
                    {validationLines.map((line, i) => {
                      const clean = line.replace(/^[\u2705\u274C\u2714\u2716\s]*/, '').replace(/\*\*/g, '');
                      const passed = line.includes('\u2705') || line.includes('\u2714');
                      const failed = line.includes('\u274C');
                      return (
                        <p key={i} className="text-[11px] text-gray-300 flex items-center gap-1.5">
                          {passed && <span className="text-green-400 text-xs shrink-0">{'\u2714'}</span>}
                          {failed && <span className="text-red-400 text-xs shrink-0">{'\u2718'}</span>}
                          <span>{clean}</span>
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // Default section
          return (
            <div key={idx} className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden`}>
              <button
                onClick={() => toggleSection(idx)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left ${colors.headerHover} transition-all`}
              >
                <span className="text-sm">{section.icon}</span>
                <span className={`text-xs font-semibold ${colors.text} flex-1`}>{section.title}</span>
                <svg
                  className={`w-3 h-3 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!isCollapsed && (
                <div className="px-3 pb-2.5">
                  {section.content.split('\n').filter(l => l.trim()).map((line, i) => (
                    <p key={i} className="text-[11px] text-gray-300 leading-relaxed my-0.5">
                      {line.replace(/\*\*/g, '').replace(/\*([^*]+)\*/g, '$1').replace(/^---+$/, '')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
