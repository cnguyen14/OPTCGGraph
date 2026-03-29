import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessage } from '../types';
import { chatSync } from '../lib/api';

interface ToolSummary {
  text: string;
}

interface EnrichedMessage extends ChatMessage {
  toolSummaries?: string[];
}

interface Props {
  sessionId: string | null;
  onSessionId: (id: string) => void;
}

export default function AIChat({ sessionId, onSessionId }: Props) {
  const [messages, setMessages] = useState<EnrichedMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: EnrichedMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setActiveTools(['Analyzing your question...']);

    try {
      const result = await chatSync(input, sessionId || undefined);
      if (result.session_id) onSessionId(result.session_id);

      const assistantMsg: EnrichedMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.text || 'No response',
        timestamp: new Date(),
        toolSummaries: result.tool_summaries || [],
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Something went wrong. Please try again.`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setActiveTools([]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg border border-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h3 className="text-white font-semibold text-base">AI Deck Building Assistant</h3>
        <p className="text-xs text-gray-500 mt-0.5">Ask about cards, deck builds, synergies, counters...</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center mt-16 space-y-4">
            <div className="text-gray-600 text-sm">Try asking:</div>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'Build me a Red Luffy deck',
                'What counters OP05-060?',
                'Tell me about OP01-025',
                'Find Rush characters under cost 5',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); }}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-full px-4 py-2 text-sm transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' ? (
              <div className="max-w-[85%] space-y-2">
                {/* Tool call indicators */}
                {msg.toolSummaries && msg.toolSummaries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {msg.toolSummaries.map((tool, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-400 rounded-full px-2.5 py-0.5 text-xs">
                        <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
                {/* Markdown response */}
                <div className="bg-gray-800/70 rounded-lg px-5 py-4 text-sm text-gray-200 prose prose-invert prose-sm max-w-none
                  prose-headings:text-white prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
                  prose-h2:text-base prose-h3:text-sm
                  prose-p:my-2 prose-p:leading-relaxed
                  prose-li:my-0.5
                  prose-strong:text-white
                  prose-code:text-blue-300 prose-code:bg-gray-900 prose-code:px-1 prose-code:rounded
                ">
                  <Markdown>{msg.content}</Markdown>
                </div>
              </div>
            ) : (
              <div className="max-w-[75%] bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {/* Loading state */}
        {loading && (
          <div className="flex justify-start">
            <div className="space-y-2 max-w-[85%]">
              <div className="flex flex-wrap gap-1.5">
                {activeTools.map((tool, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 bg-gray-800 border border-gray-700 text-gray-400 rounded-full px-2.5 py-0.5 text-xs animate-pulse">
                    <svg className="w-3 h-3 text-yellow-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    {tool}
                  </span>
                ))}
              </div>
              <div className="bg-gray-800/70 rounded-lg px-5 py-4 text-sm text-gray-400">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                  </div>
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask about cards, decks, synergies..."
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
