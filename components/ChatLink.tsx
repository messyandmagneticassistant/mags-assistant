'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function ChatLink({ children = 'Chat', className = '' }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function fetchCount() {
      try {
        const res = await fetch('/api/chat/unread');
        const data = await res.json();
        if (active) setCount(data.count || 0);
      } catch {
        /* ignore */
      }
    }
    fetchCount();
    const id = setInterval(fetchCount, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const badge = count > 0 ? (
    <span className="absolute -top-1 -right-2 bg-red-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  ) : null;

  return (
    <Link href="/chat" className={`relative ${className}`}>
      {children}
      {badge}
    </Link>
  );
}
