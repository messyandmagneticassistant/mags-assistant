import { useState } from 'react';
import { chat } from '../lib/api';

export default function IndexPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    setLoading(true);
    setMessages((m) => [...m, `You: ${input}`]);
    try {
      const res = await chat(input);
      setMessages((m) => [...m, `Bot: ${res.reply ?? ''}`]);
    } catch (err: any) {
      setMessages((m) => [...m, `Error: ${err.message}`]);
    } finally {
      setLoading(false);
      setInput('');
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Assistant</h1>
      <div style={{ border: '1px solid #ccc', padding: 10, height: 200, overflowY: 'auto' }}>
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
      />
      <button onClick={send} disabled={loading}>Send</button>
      <div style={{ marginTop: 20 }}>
        <a href="/browser"><button>Open browser</button></a>
      </div>
    </div>
  );
}
