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

/** Render a single line of markdown-like text as React elements. */
function renderMarkdownLine(line: string): React.ReactNode {
  const trimmed = line.trim();

  // Skip empty lines and horizontal rules
  if (!trimmed || /^---+$/.test(trimmed)) return null;

  // Headers (#### / ### / ##)
  const headerMatch = trimmed.match(/^(#{2,4})\s+(.+)$/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const text = headerMatch[2].replace(/\*\*/g, '');
    if (level <= 2) return <h4 className="text-xs font-bold text-text-primary mt-2 mb-1">{text}</h4>;
    if (level === 3) return <h5 className="text-[11px] font-semibold text-text-primary mt-1.5 mb-0.5">{text}</h5>;
    return <h6 className="text-[11px] font-medium text-purple-400 mt-1.5 mb-0.5">{text}</h6>;
  }

  // List items (- or *)
  const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
  const content = listMatch ? listMatch[1] : trimmed;
  const isListItem = !!listMatch;

  // Inline formatting: **bold**, *italic*, `code`
  const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  const rendered = parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) return <strong key={i} className="text-text-primary font-semibold">{boldMatch[1]}</strong>;
    const italicMatch = part.match(/^\*(.+)\*$/);
    if (italicMatch) return <em key={i} className="text-gray-400 italic">{italicMatch[1]}</em>;
    const codeMatch = part.match(/^`(.+)`$/);
    if (codeMatch) return <code key={i} className="text-purple-400 bg-purple-950/30 px-1 rounded text-[10px]">{codeMatch[1]}</code>;
    return <span key={i}>{part}</span>;
  });

  if (isListItem) {
    return (
      <div className="flex gap-1.5 my-0.5">
        <span className="text-gray-600 shrink-0">{'·'}</span>
        <span className="text-[11px] text-gray-300 leading-relaxed">{rendered}</span>
      </div>
    );
  }

  return <p className="text-[11px] text-gray-300 leading-relaxed my-0.5">{rendered}</p>;
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
      } else if (lower.includes('decklist') || lower.includes('deck list') || lower.includes('cost tier') || lower.includes('card breakdown') || lower.includes('card list')) {
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

interface CardGroup {
  header: string | null;
  cards: ParsedCard[];
  other: string[];
}

function parseCardLines(content: string): { cards: ParsedCard[]; other: string[]; groups: CardGroup[] } {
  const cards: ParsedCard[] = [];
  const other: string[] = [];
  const groups: CardGroup[] = [];
  let currentGroup: CardGroup = { header: null, cards: [], other: [] };

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^---+$/.test(trimmed)) continue;

    // Sub-headers (#### or bold headers like **0-2 Cost**)
    const subHeader = trimmed.match(/^#{3,4}\s+(.+)$/) ?? trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (subHeader) {
      // Flush current group
      if (currentGroup.cards.length > 0 || currentGroup.other.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = { header: subHeader[1].replace(/\*\*/g, '').trim(), cards: [], other: [] };
      continue;
    }

    // Match card formats
    const match = trimmed.match(
      /^[-•*]*\s*(\d+)x\s+\*{0,2}(.+?)\*{0,2}\s+\(([A-Z0-9]+-[A-Z0-9]+)\)\s*(?:[—\-–:]+\s*\*?(.*?)\*?\s*)?$/
    ) ?? trimmed.match(
      /^[-•*]*\s*\*{0,2}(.+?)\*{0,2}\s+\(([A-Z0-9]+-[A-Z0-9]+)\)\s*(?:x(\d+))?\s*(?:[—\-–:]+\s*\*?(.*?)\*?\s*)?$/
    );
    if (match) {
      const isFirstFormat = /^\d+$/.test(match[1]) && match[3]?.match(/^[A-Z0-9]+-/);
      const card = isFirstFormat
        ? { qty: match[1], name: match[2].replace(/\*\*/g, '').trim(), id: match[3].trim(), desc: (match[4] || '').replace(/\*/g, '').trim() }
        : { qty: match[3] || '1', name: match[1].replace(/\*\*/g, '').trim(), id: match[2].trim(), desc: (match[4] || '').replace(/\*/g, '').trim() };
      cards.push(card);
      currentGroup.cards.push(card);
    } else {
      other.push(trimmed);
      currentGroup.other.push(trimmed);
    }
  }
  // Flush last group
  if (currentGroup.cards.length > 0 || currentGroup.other.length > 0) {
    groups.push(currentGroup);
  }
  return { cards, other, groups };
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

          // Decklist sections — group cards by cost tier sub-headers
          if (section.type === 'decklist') {
            const { cards, groups } = parseCardLines(section.content);
            return (
              <div key={idx} className={`rounded-lg border ${isActive ? 'border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.15)]' : colors.border} ${colors.bg} overflow-hidden transition-all`}>
                <div className={`flex items-center gap-2 px-3 py-2 transition-all ${isActive ? 'bg-purple-900/20' : ''}`}>
                  <button
                    onClick={() => {
                      if (cards.length > 0) {
                        handleSectionHighlight(idx, cards);
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
                  <div className="px-3 pb-2">
                    {groups.map((group, gi) => (
                      <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
                        {group.header && (
                          <h6 className="text-[11px] font-medium text-purple-400 mt-1 mb-1">{group.header}</h6>
                        )}
                        {group.other.map((line, oi) => (
                          <div key={`o${oi}`}>{renderMarkdownLine(line)}</div>
                        ))}
                        {group.cards.map((card, ci) => (
                          <div
                            key={`c${ci}`}
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
                  {section.content.split('\n').map((line, i) => (
                    <div key={i}>{renderMarkdownLine(line)}</div>
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
