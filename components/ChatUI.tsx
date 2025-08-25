'use client';
import { useEffect, useRef, useState } from 'react';

const palette = {
  sage: '#9BB5A3',
  blush: '#E8C8C3',
  cream: '#FBF6EF',
  charcoal: '#2B2B2B',
  gold: '#D8B26E',
};

type Message = { role: 'user' | 'assistant'; content: string };

function renderMessage(text: string) {
  const parts = text.split(/```([\s\S]*?)```/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/^\n|\n$/g, '');
      return (
        <pre
          key={i}
          className="relative p-2 rounded bg-gray-900 text-gray-100 font-mono text-sm whitespace-pre-wrap"
        >
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="absolute top-1 right-1 text-xs text-yellow-200"
          >
            copy
          </button>
          {code}
        </pre>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatUI() {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem('mags-chat-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('mags-chat-history', JSON.stringify(messages));
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  async function send(prompt?: string) {
    const content = prompt ?? input.trim();
    if (!content) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: newMessages }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistant += decoder.decode(value);
        setMessages([...newMessages, { role: 'assistant', content: assistant }]);
      }
    } catch (err: any) {
      console.error(err);
      setMessages([...newMessages, { role: 'assistant', content: 'Error: ' + err.message }]);
    } finally {
      setLoading(false);
    }
  }

  const quick = [
    { label: 'Sync Stripe ↔ Notion', prompt: 'Sync Stripe and Notion (two-way)' },
    { label: 'Generate on-brand image for selected product', prompt: 'Generate on-brand image for selected product' },
    { label: 'Audit Stripe products (propose fixes)', prompt: 'Audit Stripe products and propose fixes' },
    { label: 'Create Notion task from this chat', prompt: 'Create a Notion task from this chat' },
  ];

  return (
    <div
      className="flex flex-col h-full bg-[var(--cream)] text-[var(--charcoal)]"
      style={{
        // CSS vars for easy override
        // @ts-ignore
        '--sage': palette.sage,
        '--blush': palette.blush,
        '--cream': palette.cream,
        '--charcoal': palette.charcoal,
        '--gold': palette.gold,
      }}
    >
      <div className="flex gap-2 p-2 border-b overflow-x-auto" style={{ background: palette.cream }}>
        {quick.map((q) => (
          <button
            key={q.label}
            onClick={() => send(q.prompt)}
            className="text-sm px-3 py-1 rounded-full border"
            style={{ borderColor: palette.gold }}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-4" style={{ background: palette.cream }}>
        {messages.map((m, i) => (
          <div key={i} className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              className="max-w-[80%] rounded-lg p-2 shadow"
              style={{
                background: m.role === 'user' ? palette.cream : palette.sage,
                color: palette.charcoal,
              }}
            >
              <div className="whitespace-pre-wrap break-words">{renderMessage(m.content)}</div>
            </div>
          </div>
        ))}
        {loading && <div className="text-sm" style={{ color: palette.charcoal }}>Thinking…</div>}
      </div>
      <div className="p-3 border-t" style={{ background: palette.cream }}>
        <textarea
          className="w-full border rounded p-2 resize-none focus:outline-none"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{ borderColor: palette.sage, background: '#fff' }}
        />
        <button
          onClick={() => send()}
          className="mt-2 px-4 py-1 rounded"
          style={{ background: palette.sage, color: palette.charcoal }}
          disabled={loading}
        >
          Send
        </button>
      </div>
    </div>
  );
}
