import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { chatSync } from '../lib/api';

interface Props {
  sessionId: string | null;
  onSessionId: (id: string) => void;
}

export default function AIChat({ sessionId, onSessionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await chatSync(input, sessionId || undefined);
      if (result.session_id) onSessionId(result.session_id);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.text || 'No response',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg border border-gray-800">
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-white font-semibold">AI Deck Building Assistant</h3>
        <p className="text-xs text-gray-500">Ask about cards, deck builds, synergies, counters...</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-gray-600 text-sm text-center mt-10">
            <p>Try asking:</p>
            <p className="text-gray-500 mt-2">"Build me a Red Luffy deck"</p>
            <p className="text-gray-500">"What counters OP05-060?"</p>
            <p className="text-gray-500">"Find Rush characters under cost 5"</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-200'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-400 rounded-lg px-4 py-2 text-sm animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask about cards, decks, synergies..."
            className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg px-4 py-2 text-sm transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
