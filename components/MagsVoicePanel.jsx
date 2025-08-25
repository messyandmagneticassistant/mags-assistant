import { useState, useRef } from 'https://esm.sh/react@18';

export default function MagsVoicePanel({ magsKey }) {
  const [mode, setMode] = useState('plan');
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);
  const [out, setOut] = useState('');
  const recRef = useRef(null);

  function start() {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Speech recognition not supported');
      return;
    }
    const r = new webkitSpeechRecognition();
    r.lang = 'en-US';
    r.continuous = false;
    r.onresult = e => {
      const t = e.results[0][0].transcript;
      setText(t);
      if (mode === 'run') runCommand(t); else planCommand(t);
    };
    r.onend = () => setListening(false);
    r.start();
    recRef.current = r;
    setListening(true);
  }

  function stop() {
    recRef.current && recRef.current.stop();
    setListening(false);
  }

  async function planCommand(t) {
    const res = await fetch('/api/agent/plan', {
      method: 'POST',
      headers: { 'x-mags-key': magsKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: t })
    });
    const data = await res.json();
    setPlan(data.plan);
    setOut(JSON.stringify(data, null, 2));
  }

  async function runCommand(t) {
    const res = await fetch('/api/agent/command', {
      method: 'POST',
      headers: { 'x-mags-key': magsKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: t })
    });
    const data = await res.json();
    setOut(JSON.stringify(data, null, 2));
  }

  async function approve() {
    if (!plan) return;
    const res = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'x-mags-key': magsKey, 'content-type': 'application/json' },
      body: JSON.stringify({ plan, text })
    });
    const data = await res.json();
    setPlan(null);
    setOut(JSON.stringify(data, null, 2));
  }

  return (
    <div style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:16}}>
      <h3>Voice Control</h3>
      <div style={{marginBottom:8}}>
        <label>Mode: </label>
        <select value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="plan">Speak & Plan</option>
          <option value="run">Speak & Run</option>
        </select>
      </div>
      <button onClick={listening?stop:start}>{listening ? 'Stop' : '\uD83C\uDF99\uFE0F Start'}</button>
      {mode==='plan' && plan && <button onClick={approve} style={{marginLeft:8}}>Approve Plan & Run</button>}
      <div style={{marginTop:8}}><strong>Transcript:</strong> {text}</div>
      <pre style={{whiteSpace:'pre-wrap', marginTop:8}}>{out}</pre>
    </div>
  );
}
