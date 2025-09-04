import React from 'react';
import ReactDOM from 'react-dom/client';
import IndexPage from './pages/index';
import BrowserPage from './pages/browser';

const root = document.getElementById('root')!;
const path = window.location.pathname;
const Page = path.startsWith('/browser') ? BrowserPage : IndexPage;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);
