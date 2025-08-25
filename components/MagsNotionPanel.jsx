import { useState } from 'https://esm.sh/react@18';

export default function MagsNotionPanel({ magsKey }) {
  const [out, setOut] = useState('');
  async function call(path, method = 'GET', body) {
    const res = await fetch(path, {
      method,
      headers: {
        'x-mags-key': magsKey,
        'content-type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json();
    setOut(JSON.stringify(json, null, 2));
  }
  return (
    <div style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:16}}>
      <h3>Notion Controls</h3>
      <button onClick={() => call('/api/notion/tasks')}>List Notion Tasks</button>
      <button onClick={() => call('/api/notion/tasks','POST',{title:'Test from Mags',status:'Todo',notes:'hello'})}>Add Test Task</button>
      <button onClick={() => call('/api/notion/notes','POST',{text:'Note from Mags'})}>Append Note</button>
      <pre style={{whiteSpace:'pre-wrap', marginTop:12}}>{out}</pre>
    </div>
  );
}
