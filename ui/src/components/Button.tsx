import React from 'react';

export default function Button({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls = 'px-4 py-2 bg-indigo-500 text-white rounded';
  if (href) return <a className={cls} href={href}>{children}</a>;
  return <button className={cls} onClick={onClick}>{children}</button>;
}
