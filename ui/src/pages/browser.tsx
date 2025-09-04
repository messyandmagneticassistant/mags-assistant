import { useEffect, useRef, useState } from 'react';
import { createBrowserSession } from '../lib/api';

export default function BrowserPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let ws: WebSocket;

    async function start() {
      try {
        const { wsUrl } = await createBrowserSession();
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setStatus('connected');
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'frame' && imgRef.current) {
              imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
            } else if (msg.type === 'cursor' && cursorRef.current) {
              cursorRef.current.style.left = `${msg.x}px`;
              cursorRef.current.style.top = `${msg.y}px`;
            }
          } catch {}
        };
        ws.onclose = () => setStatus('closed');
      } catch {
        setStatus('error');
      }
    }

    start();
    return () => {
      if (ws) ws.close();
    };
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <p>{status}</p>
      <img ref={imgRef} style={{ width: '100%' }} />
      <div
        ref={cursorRef}
        style={{
          position: 'absolute',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'red',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
