import Nav from '../components/Nav';
import React from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body className="min-h-screen flex flex-col">
        <Nav />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
