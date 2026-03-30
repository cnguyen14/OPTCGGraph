import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { chatSync } from '../lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolSummaries?: string[];
}

interface Props {
  sessionId: string | null;
  onSessionId: (id: string) => void;
  leaderId?: string | null;
  onUiUpdate?: (update: { action: string; payload: Record<string, unknown> }) => void;
}

export default function FloatingChat({ sessionId, onSessionId, leaderId, onUiUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await chatSync(input, sessionId || undefined, leaderId || undefined);
      if (result.session_id) onSessionId(result.session_id);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.text || 'No response',
        toolSummaries: result.tool_summaries || [],
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (!open) setUnread(prev => prev + 1);

      // Process AG-UI updates
      for (const update of (result.ui_updates || [])) {
        onUiUpdate?.(update);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', content: 'Something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
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
            {messages.length === 0 && (
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

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800/70 rounded-lg px-3 py-2.5 text-xs text-gray-400 flex items-center gap-2">
                  <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 border-t border-gray-800 shrink-0">
            <div className="flex gap-2">
              <input
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
