import { useState, useEffect } from 'https://esm.sh/react@18';

export default function MagsRunsPanel({ magsKey }) {
  const [runs, setRuns] = useState([]);
  const [out, setOut] = useState('');
  async function load() {
    const res = await fetch('/api/agent/jobs', { headers: { 'x-mags-key': magsKey } });
    const data = await res.json();
    setRuns(data.results || []);
    setOut(JSON.stringify(data, null, 2));
  }
  useEffect(() => { load(); }, []);
  return (
    <div style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:16}}>
      <h3>Runs</h3>
      <button onClick={load}>Refresh</button>
      <ul>
        {runs.map(r => (
          <li key={r.id}>{r.properties?.Name?.title?.[0]?.plain_text}</li>
        ))}
      </ul>
      <pre style={{whiteSpace:'pre-wrap', marginTop:8}}>{out}</pre>
    </div>
  );
}
