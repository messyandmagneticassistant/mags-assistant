'use client';
import Link from 'next/link';
import ChatLink from './ChatLink';

export default function Nav() {
  return (
    <nav className="flex gap-4 p-2 border-b bg-white">
      <Link href="/">Home</Link>
      <ChatLink />
      <Link href="/planner">Planner</Link>
    </nav>
  );
}
