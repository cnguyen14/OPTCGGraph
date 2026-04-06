import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { Button } from '../../components/ui';
import CardDetail from '../cards/CardDetail';
import { fetchCard, fetchChatSessions, loadChatSession, deleteChatSession } from '../../lib/api';
import type { SessionSummary } from '../../lib/api';
import type { Card } from '../../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolSummaries?: string[];
}

interface ToolStep {
  tool: string;
  label: string;
  status: 'running' | 'done';
}

interface Suggestion {
  label: string;
  value: string;
  description?: string;
}

interface Props {
  sessionId: string | null;
  onSessionId: (id: string) => void;
  clientId: string;
  leaderId?: string | null;
  deckCardIds?: string[];
  onUiUpdate?: (update: { action: string; payload: Record<string, unknown> }) => void;
  onOpenChange?: (open: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  get_card: 'Looking up card details',
  find_synergies: 'Finding synergies',
  find_counters: 'Finding counters',
  query_neo4j: 'Querying knowledge graph',
  build_deck_shell: 'Building deck',
  validate_deck: 'Validating deck',
  suggest_deck_fixes: 'Generating suggestions',
  get_mana_curve: 'Analyzing mana curve',
  update_ui_state: 'Updating interface',
  analyze_leader_playstyles: 'Analyzing playstyles',
  get_banned_cards: 'Checking banned cards',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function humanize(tool: string): string {
  return TOOL_LABELS[tool] ?? `Using ${tool}`;
}

const OP_QUOTES_IDLE = [
  'Setting sail on the Grand Line...',
  'The seas are vast, let me explore...',
  'Navigating the New World...',
  'Charting a course through the calm belt...',
  'The adventure begins!',
  'Full speed ahead!',
  'Kaizoku ou ni ore wa naru!',
];

const OP_QUOTES_TOOLS = [
  'Gathering intel from the crew...',
  'Searching the Poneglyph...',
  'Reading the sea charts...',
  'The Log Pose is pointing this way...',
  'Consulting the Straw Hat crew...',
  'Nami is checking the weather...',
  'Robin is deciphering the clues...',
  'Chopper is analyzing the data...',
];

function randomQuote(hasTools: boolean): string {
  const quotes = hasTools ? OP_QUOTES_TOOLS : OP_QUOTES_IDLE;
  return quotes[Math.floor(Math.random() * quotes.length)];
}

export default function FloatingChat({ sessionId, onSessionId, clientId, leaderId, deckCardIds, onUiUpdate, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [steps, setSteps] = useState<ToolStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract card ID from image URL or alt text (e.g., "OP01-025")
  const handleImageClick = useCallback(async (src: string, alt: string) => {
    // Try to find card ID from alt text or URL
    const cardIdPattern = /([A-Z]{2,3}\d{2}-\d{3})/;
    const match = alt?.match(cardIdPattern) || src?.match(cardIdPattern);
    if (match) {
      try {
        const card = await fetchCard(match[1]);
        setPreviewCard(card);
      } catch { /* ignore */ }
    }
  }, []);

  // Colorize text based on content patterns
  const colorizeStrong = (children: React.ReactNode): { className: string } => {
    const text = String(children ?? '');
    // Card names — contains card ID pattern like (OP01-025) or is a known card name with parens
    if (/[A-Z]{2,3}\d{2}-\d{3}/.test(text) || /\(\d{3}\)/.test(text))
      return { className: 'text-amber-300 font-bold' };
    // Label-style bold ending with colon — amber
    if (/^(Card|Name|Type|Rarity|Set|Attribute|Image|Families):?$/i.test(text))
      return { className: 'text-amber-400 font-semibold' };
    // Prices — green
    if (/price|cost|market|\$/i.test(text))
      return { className: 'text-emerald-400 font-semibold' };
    // Stats — cyan
    if (/power|counter|life|stats/i.test(text))
      return { className: 'text-cyan-400 font-semibold' };
    // Keywords/abilities — purple
    if (/rush|blocker|double attack|banish|trigger|counter|ability|keyword/i.test(text))
      return { className: 'text-violet-400 font-semibold' };
    // Strategy labels — orange
    if (/strategy|role|synerg|partner|strength|weakness/i.test(text))
      return { className: 'text-orange-400 font-semibold' };
    // Tournament stats — blue
    if (/tournament|pick rate|top cut|meta|win rate/i.test(text))
      return { className: 'text-blue-400 font-semibold' };
    // Default bold — slightly brighter than body text
    return { className: 'text-text-primary font-semibold' };
  };

  // Colorize inline patterns within text nodes
  const colorizeInlineText = (node: React.ReactNode): React.ReactNode => {
    if (typeof node !== 'string') return node;
    // Split on patterns we want to colorize:
    // Card IDs: (OP01-025) or OP01-025
    // Prices: $6.23
    // Percentages: 2.21%
    // Keyword values: Rush, Blocker, Double Attack, Banish (standalone after colon)
    const pattern = /(\(?[A-Z]{2,3}\d{2}-\d{3}\)?|\$\d+(?:\.\d+)?|\d+(?:\.\d+)?%|\b(?:Rush|Blocker|Double Attack|Banish|Slash|Strike|Ranged|Wisdom|Special)\b)/g;
    const parts = node.split(pattern);
    if (parts.length === 1) return node;
    return parts.map((part, i) => {
      // Card IDs — cyan, clickable
      if (/^\(?[A-Z]{2,3}\d{2}-\d{3}\)?$/.test(part)) {
        const cardId = part.replace(/[()]/g, '');
        return (
          <button
            key={i}
            onClick={() => handleImageClick('', cardId)}
            className="text-cyan-400 hover:text-cyan-300 font-mono text-[10px] hover:underline cursor-pointer"
            title={`View ${cardId}`}
          >
            {part}
          </button>
        );
      }
      // Prices — green
      if (/^\$\d+(?:\.\d+)?$/.test(part)) {
        return <span key={i} className="text-emerald-400 font-medium">{part}</span>;
      }
      // Percentages — blue
      if (/^\d+(?:\.\d+)?%$/.test(part)) {
        return <span key={i} className="text-blue-400 font-medium">{part}</span>;
      }
      // Keywords/attributes — violet
      if (/^(?:Rush|Blocker|Double Attack|Banish|Slash|Strike|Ranged|Wisdom|Special)$/.test(part)) {
        return <span key={i} className="text-violet-400 font-medium">{part}</span>;
      }
      return part;
    });
  };

  // Custom Markdown components for professional rendering
  const mdComponents: Components = {
    img: ({ src, alt, ...props }) => (
      <button
        onClick={() => handleImageClick(src ?? '', alt ?? '')}
        className="inline-block my-1 cursor-pointer group"
        title="Click to preview card"
      >
        <img
          {...props}
          src={src}
          alt={alt}
          className="w-20 h-28 object-cover rounded-lg border border-glass-border group-hover:border-op-ocean/60 group-hover:shadow-glow-ocean transition-all"
        />
      </button>
    ),
    h1: ({ children }) => <h3 className="text-sm font-bold text-amber-400 mt-2 mb-1">{children}</h3>,
    h2: ({ children }) => <h4 className="text-xs font-bold text-amber-400 mt-2 mb-0.5">{children}</h4>,
    h3: ({ children }) => <h5 className="text-[11px] font-semibold text-amber-300 mt-1.5 mb-0.5">{children}</h5>,
    strong: ({ children }) => <strong className={colorizeStrong(children).className}>{children}</strong>,
    ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1 marker:text-text-muted">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1 marker:text-text-muted">{children}</ol>,
    li: ({ children }) => {
      const mapped = Array.isArray(children)
        ? children.map((c, i) => <span key={i}>{colorizeInlineText(c)}</span>)
        : colorizeInlineText(children);
      return <li className="text-[11px] leading-relaxed">{mapped}</li>;
    },
    p: ({ children }) => {
      const mapped = Array.isArray(children)
        ? children.map((c, i) => <span key={i}>{colorizeInlineText(c)}</span>)
        : colorizeInlineText(children);
      return <p className="text-[11px] leading-relaxed my-1">{mapped}</p>;
    },
    code: ({ children }) => {
      const text = String(children ?? '');
      // Card IDs — cyan with click to preview
      if (/^[A-Z]{2,3}\d{2}-\d{3}$/.test(text)) {
        return (
          <button
            onClick={() => handleImageClick('', text)}
            className="bg-cyan-900/30 text-cyan-400 border border-cyan-700/30 px-1.5 py-0.5 rounded text-[10px] font-mono hover:bg-cyan-900/50 hover:border-cyan-600/50 transition-colors cursor-pointer"
            title={`View ${text}`}
          >
            {text}
          </button>
        );
      }
      // Prices — green
      if (/^\$[\d.]+$/.test(text)) {
        return <code className="bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 px-1.5 py-0.5 rounded text-[10px] font-mono">{text}</code>;
      }
      // Default code
      return <code className="bg-surface-2 text-op-ocean px-1 py-0.5 rounded text-[10px] font-mono">{children}</code>;
    },
    hr: () => <hr className="border-glass-border my-2" />,
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, steps, streamingText, suggestions]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('optcg-chat-session');
    if (saved && !sessionId) {
      onSessionId(saved);
      // Load messages from backend
      loadChatSession(saved).then((data) => {
        if (data?.messages) {
          setMessages(data.messages.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sessionId to localStorage, clear messages when session reset
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('optcg-chat-session', sessionId);
    } else {
      localStorage.removeItem('optcg-chat-session');
      setMessages([]);
    }
  }, [sessionId]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const sessions = await fetchChatSessions(clientId);
      setSessionList(sessions);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRestoreSession = async (sid: string) => {
    const data = await loadChatSession(sid);
    if (data?.messages) {
      setMessages(data.messages.map((m) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })));
      onSessionId(sid);
      setSuggestions([]);
      setShowHistory(false);
    }
  };

  const handleDeleteSession = async (sid: string) => {
    await deleteChatSession(sid, clientId);
    setSessionList((prev) => prev.filter((s) => s.session_id !== sid));
    if (sessionId === sid) {
      setMessages([]);
      onSessionId('');
      localStorage.removeItem('optcg-chat-session');
    }
  };

  const handleToggle = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const handleSend = async (overrideMessage?: string) => {
    const msg = overrideMessage ?? input;
    if (!msg.trim() || loading) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSuggestions([]);
    setLoading(true);
    setSteps([]);
    setStreamingText('');

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientId,
        },
        body: JSON.stringify({
          message: msg,
          session_id: sessionId,
          leader_id: leaderId,
          deck_card_ids: deckCardIds,
        }),
      });

      // Read session ID from header
      const newSessionId = resp.headers.get('X-Session-ID');
      if (newSessionId) onSessionId(newSessionId);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      const toolSummaries: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'STEP_STARTED':
                setSteps(prev => [...prev, { tool: event.tool, label: humanize(event.tool), status: 'running' }]);
                break;

              case 'STEP_FINISHED':
                setSteps(prev => prev.map(s =>
                  s.tool === event.tool && s.status === 'running' ? { ...s, status: 'done' } : s
                ));
                toolSummaries.push(humanize(event.tool));
                break;

              case 'TextMessageContent':
                fullText += event.delta ?? '';
                setStreamingText(fullText);
                break;

              case 'SUGGESTIONS':
                setSuggestions(event.suggestions || []);
                break;

              case 'STATE_SNAPSHOT':
                onUiUpdate?.(event);
                break;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Only add assistant message if there's actual content or no tools ran
      if (fullText || toolSummaries.length === 0) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullText || 'I processed your request but couldn\'t generate a response. Please try again.',
          toolSummaries,
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else if (toolSummaries.length > 0 && !fullText) {
        // Tools ran but no text — still show tool summaries
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          toolSummaries,
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
      if (!open) setUnread(prev => prev + 1);
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', content: 'Something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
      setSteps([]);
      setStreamingText('');
    }
  };

  return (
    <div
      className={`relative h-full shrink-0 flex flex-col overflow-hidden rounded-[var(--radius-glass-lg)] border border-glass-border-hover transition-all duration-300 ease-[var(--ease-glass)] ${
        open ? 'w-[360px] opacity-100' : 'w-11 opacity-100'
      }`}
      style={{ background: 'rgba(30, 32, 45, 0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      {/* Map texture overlay */}
      <div className="absolute inset-0 opacity-[0.06] bg-cover bg-center pointer-events-none z-0" style={{ backgroundImage: 'url(/images/op-world-map.jpg)' }} />

      {/* Collapsed state — vertical tab */}
      {!open && (
        <button
          onClick={() => handleToggle(true)}
          className="relative z-10 h-full w-full flex flex-col items-center justify-center gap-2 hover:bg-surface-3 transition-colors cursor-pointer group"
          title="Open AI Assistant"
        >
          <div className="w-7 h-7 rounded-full bg-op-red group-hover:bg-op-red-light flex items-center justify-center shadow-glow-red transition-colors relative">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unread}
              </span>
            )}
          </div>
          <span className="text-[10px] font-semibold text-text-muted [writing-mode:vertical-lr] tracking-wider uppercase">
            AI Chat
          </span>
        </button>
      )}

      {/* Expanded state — full chat */}
      {open && (
        <>
          {/* Header */}
          <div className="relative z-10 px-4 py-3 border-b border-glass-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-op-red flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h3 className="text-text-primary font-semibold text-sm whitespace-nowrap">AI Assistant</h3>
                <p className="text-[10px] text-text-muted whitespace-nowrap">Cards, decks, synergies, validation...</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setMessages([]);
                  setSuggestions([]);
                  setSteps([]);
                  setStreamingText('');
                  setShowHistory(false);
                  onSessionId('');
                  localStorage.removeItem('optcg-chat-session');
                }}
                className="text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1 rounded-md hover:bg-surface-2"
                title="New Chat"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
                className={`text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1 rounded-md hover:bg-surface-2 ${showHistory ? 'text-op-ocean bg-surface-2' : ''}`}
                title="Chat History"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </button>
              <button onClick={() => handleToggle(false)} className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* History panel */}
          {showHistory ? (
            <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">Chat History</p>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-[10px] text-op-ocean hover:underline"
                >
                  Back to chat
                </button>
              </div>
              {historyLoading ? (
                <p className="text-xs text-text-muted text-center mt-8">Loading...</p>
              ) : sessionList.length === 0 ? (
                <p className="text-xs text-text-muted text-center mt-8">No past conversations</p>
              ) : (
                <div className="space-y-1.5">
                  {sessionList.map((s) => (
                    <div
                      key={s.session_id}
                      className={`group flex items-start gap-2 glass-subtle rounded-lg px-3 py-2 cursor-pointer hover:bg-surface-2 transition-colors ${
                        sessionId === s.session_id ? 'border border-op-ocean/40 bg-op-ocean/10' : ''
                      }`}
                      onClick={() => handleRestoreSession(s.session_id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-text-primary font-medium truncate">
                          {s.title || 'Untitled'}
                        </p>
                        <p className="text-[9px] text-text-muted mt-0.5">
                          {s.message_count} messages &middot; {timeAgo(s.updated_at)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.session_id); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all p-0.5 shrink-0"
                        title="Delete"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <>
          {/* Messages */}
          <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="text-center mt-8 space-y-3">
                <p className="text-text-muted text-xs">Try:</p>
                {['Build a Red Zoro deck', 'Validate my current deck', 'Tell me about OP01-025'].map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="block w-full glass-subtle glass-hover text-text-secondary text-xs rounded-lg px-3 py-2 text-left transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' ? (
                  <div className="max-w-[90%] space-y-1.5">
                    {msg.toolSummaries && msg.toolSummaries.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(msg.toolSummaries)].map((t, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-gray-800 text-gray-400 rounded-full px-2 py-0.5 text-[10px]">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />{t}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className="glass-subtle rounded-lg px-3 py-2.5 text-[11px] text-text-secondary">
                        <Markdown components={mdComponents}>{msg.content}</Markdown>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-[75%] bg-op-red text-white rounded-2xl rounded-br-sm px-3 py-2 text-xs">
                    {msg.content}
                  </div>
                )}
              </div>
            ))}

            {/* Live status during streaming */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[90%] space-y-2">
                  {/* Tool steps — realtime */}
                  {steps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {steps.map((step, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-gray-800 text-gray-400 rounded-full px-2 py-0.5 text-[10px]">
                          {step.status === 'running' ? (
                            <svg className="w-2.5 h-2.5 text-yellow-400 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          ) : (
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                          )}
                          {step.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Streaming text preview */}
                  {streamingText ? (
                    <div className="glass-subtle rounded-lg px-3 py-2.5 text-[11px] text-text-secondary">
                      <Markdown components={mdComponents}>{streamingText}</Markdown>
                      <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse ml-0.5" />
                    </div>
                  ) : (
                    <div className="glass-subtle rounded-xl overflow-hidden">
                      {/* Ocean scene */}
                      <div className="relative h-16 bg-gradient-to-b from-sky-950/40 via-sky-900/30 to-cyan-900/40 flex items-end justify-center overflow-hidden">
                        {/* Stars */}
                        <div className="absolute top-2 left-4 w-1 h-1 bg-white/40 rounded-full animate-pulse" />
                        <div className="absolute top-3 right-8 w-0.5 h-0.5 bg-white/30 rounded-full animate-pulse" style={{ animationDelay: '500ms' }} />
                        <div className="absolute top-1 right-16 w-0.5 h-0.5 bg-white/20 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />

                        {/* Ship sailing */}
                        <img
                          src="/images/thousand-sunny.png"
                          alt=""
                          className="w-14 h-auto relative z-10 mb-1 drop-shadow-lg"
                          style={{
                            animation: 'shipSail 3s ease-in-out infinite',
                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                          }}
                        />

                        {/* Waves */}
                        <div className="absolute bottom-0 left-0 right-0 h-3">
                          <svg viewBox="0 0 200 10" className="w-full h-full" preserveAspectRatio="none">
                            <path
                              d="M0 5 Q25 0 50 5 T100 5 T150 5 T200 5 V10 H0 Z"
                              fill="rgba(6,182,212,0.2)"
                              style={{ animation: 'waveMove 2s linear infinite' }}
                            />
                            <path
                              d="M0 6 Q25 2 50 6 T100 6 T150 6 T200 6 V10 H0 Z"
                              fill="rgba(6,182,212,0.15)"
                              style={{ animation: 'waveMove 2.5s linear infinite reverse' }}
                            />
                          </svg>
                        </div>
                      </div>

                      {/* Quote text */}
                      <div className="px-3 py-2 text-center">
                        <p className="text-[10px] text-cyan-400/80 italic animate-pulse">
                          {randomQuote(steps.length > 0)}
                        </p>
                      </div>

                      {/* Inline keyframes */}
                      <style>{`
                        @keyframes shipSail {
                          0%, 100% { transform: translateY(0px) rotate(-2deg); }
                          25% { transform: translateY(-3px) rotate(1deg); }
                          50% { transform: translateY(-1px) rotate(3deg); }
                          75% { transform: translateY(-4px) rotate(0deg); }
                        }
                        @keyframes waveMove {
                          0% { transform: translateX(0); }
                          100% { transform: translateX(-50px); }
                        }
                      `}</style>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Suggestion buttons */}
            {suggestions.length > 0 && !loading && (
              <div className="px-2 py-2 space-y-1.5">
                <p className="text-text-muted text-[10px] uppercase tracking-wide px-1">Choose an option</p>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(s.value)}
                    className="block w-full glass-subtle glass-hover border border-glass-border hover:border-op-ocean/50 text-left rounded-lg px-3 py-2 transition-all group"
                  >
                    <span className="text-xs text-text-primary font-medium group-hover:text-op-ocean">{s.label}</span>
                    {s.description && (
                      <span className="block text-[10px] text-text-muted mt-0.5">{s.description}</span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => { setSuggestions([]); inputRef.current?.focus(); }}
                  className="block w-full text-center text-[10px] text-text-muted hover:text-text-secondary py-1.5 transition-colors"
                >
                  Type your own...
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
          </>
          )}

          {/* Input */}
          <div className="relative z-10 px-3 py-2.5 border-t border-glass-border shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask anything..."
                className="flex-1 bg-surface-1 text-text-primary border border-glass-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-op-ocean/50 focus:border-op-ocean placeholder:text-text-muted"
                disabled={loading}
              />
              <Button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                variant="primary"
                size="sm"
                className="rounded-xl"
              >
                Send
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Card preview modal — rendered via portal to escape overflow-hidden */}
      {previewCard && createPortal(
        <CardDetail card={previewCard} onClose={() => setPreviewCard(null)} />,
        document.body,
      )}
    </div>
  );
}
