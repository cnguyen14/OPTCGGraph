import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';

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
  leaderId?: string | null;
  deckCardIds?: string[];
  onUiUpdate?: (update: { action: string; payload: Record<string, unknown> }) => void;
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
};

function humanize(tool: string): string {
  return TOOL_LABELS[tool] ?? `Using ${tool}`;
}

export default function FloatingChat({ sessionId, onSessionId, leaderId, deckCardIds, onUiUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [steps, setSteps] = useState<ToolStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, steps, streamingText, suggestions]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

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
        headers: { 'Content-Type': 'application/json' },
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

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullText || 'No response',
        toolSummaries,
      };
      setMessages(prev => [...prev, assistantMsg]);
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
    <>
      {/* Chat Popup */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[380px] h-[520px] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-white font-semibold text-sm">AI Assistant</h3>
              <p className="text-[10px] text-gray-500">Cards, decks, synergies, validation...</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="text-center mt-8 space-y-3">
                <p className="text-gray-600 text-xs">Try:</p>
                {['Build a Red Zoro deck', 'Validate my current deck', 'Tell me about OP01-025'].map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="block w-full bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg px-3 py-2 text-left transition-colors">
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
                        {msg.toolSummaries.map((t, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-gray-800 text-gray-400 rounded-full px-2 py-0.5 text-[10px]">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />{t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="bg-gray-800/70 rounded-lg px-3 py-2.5 text-xs text-gray-200 prose prose-invert prose-xs max-w-none
                      prose-headings:text-white prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                      prose-h2:text-sm prose-h3:text-xs prose-p:my-1.5 prose-li:my-0.5 prose-strong:text-white">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[75%] bg-blue-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-xs">
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
                    <div className="bg-gray-800/70 rounded-lg px-3 py-2.5 text-xs text-gray-200 prose prose-invert prose-xs max-w-none
                      prose-headings:text-white prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                      prose-h2:text-sm prose-h3:text-xs prose-p:my-1.5 prose-li:my-0.5 prose-strong:text-white">
                      <Markdown>{streamingText}</Markdown>
                      <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse ml-0.5" />
                    </div>
                  ) : (
                    <div className="bg-gray-800/70 rounded-lg px-3 py-2.5 text-xs text-gray-400 flex items-center gap-2">
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      {steps.length === 0 ? 'Analyzing...' : 'Generating response...'}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Suggestion buttons */}
            {suggestions.length > 0 && !loading && (
              <div className="px-2 py-2 space-y-1.5">
                <p className="text-gray-500 text-[10px] uppercase tracking-wide px-1">Choose an option</p>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(s.value)}
                    className="block w-full bg-gray-800/80 hover:bg-blue-600/20 border border-gray-700 hover:border-blue-500/50 text-left rounded-lg px-3 py-2 transition-all group"
                  >
                    <span className="text-xs text-white font-medium group-hover:text-blue-400">{s.label}</span>
                    {s.description && (
                      <span className="block text-[10px] text-gray-500 mt-0.5">{s.description}</span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => { setSuggestions([]); inputRef.current?.focus(); }}
                  className="block w-full text-center text-[10px] text-gray-500 hover:text-gray-300 py-1.5 transition-colors"
                >
                  Type your own...
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 border-t border-gray-800 shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask anything..."
                className="flex-1 bg-gray-800 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-xl px-3 py-2 text-xs font-medium transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Float Button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        title="AI Assistant"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread}
              </span>
            )}
          </>
        )}
      </button>
    </>
  );
}
