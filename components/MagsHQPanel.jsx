import { useState } from 'https://esm.sh/react@18';

export default function MagsHQPanel({ magsKey }) {
  const [out, setOut] = useState('');
  async function call(path, method = 'GET', body) {
    const res = await fetch(path, {
      method,
      headers: { 'x-mags-key': magsKey, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    setOut(JSON.stringify(await res.json(), null, 2));
  }
  return (
    <div style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:16}}>
      <h3>HQ Controls</h3>
      <button onClick={() => call('/api/notion/hq/children')}>List HQ Children</button>
      <button onClick={() => call('/api/notion/hq/subpage','POST',{ title:'From Mags' })}>Create Subpage</button>
      <button onClick={() => call('/api/notion/hq/note','POST',{ text:'Hello from Mags' })}>Append Note</button>
      <pre style={{whiteSpace:'pre-wrap', marginTop:12}}>{out}</pre>
    </div>
  );
}
