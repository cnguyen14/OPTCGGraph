import type { ReactNode } from 'react';

const TIMING_KEYWORDS = new Set([
  'On Play', 'When Attacking', 'On Block', 'End of Turn', 'End of Your Turn',
  'Activate: Main', 'On K.O.', "On Your Opponent's Attack", 'Counter', 'Trigger',
  "Opponent's Turn", 'Your Turn', 'Main',
]);

const ABILITY_KEYWORDS = new Set([
  'Rush', 'Blocker', 'Double Attack', 'Banish',
]);

function getKeywordStyle(text: string): string {
  if (text.startsWith('DON!!')) return 'bg-amber-900 text-amber-200';
  if (text === 'Once Per Turn') return 'bg-teal-900 text-teal-200';
  if (TIMING_KEYWORDS.has(text)) return 'bg-red-900 text-red-200';
  if (ABILITY_KEYWORDS.has(text)) return 'bg-green-900 text-green-200';
  return 'bg-gray-700 text-gray-200';
}

export function renderAbility(text: string, small = false): ReactNode[] {
  const parts = text.split(/(\[[^\]]+\])/g);
  const sizeClass = small ? 'text-[9px] px-1 py-px' : 'text-xs px-1.5 py-0.5';
  return parts.map((part, i) => {
    const match = part.match(/^\[(.+)\]$/);
    if (match) {
      const keyword = match[1];
      const style = getKeywordStyle(keyword);
      return (
        <span key={i} className={`${style} rounded ${sizeClass} font-semibold inline-block mx-0.5`}>
          {keyword}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
