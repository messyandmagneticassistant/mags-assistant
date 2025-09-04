import React from 'react';
import ReactDOM from 'react-dom/client';
import IndexPage from './pages/index';
import BrowserPage from './pages/browser';
import OfferingsPage from './pages/offerings';
import IntakePage from './pages/intake';
import DonorsPage from './pages/donors';
import DownloadsPage from './pages/downloads';
import AboutPage from './pages/about';
import './index.css';

const routes: Record<string, React.ComponentType> = {
  '/': IndexPage,
  '/offerings': OfferingsPage,
  '/intake': IntakePage,
  '/donors': DonorsPage,
  '/downloads': DownloadsPage,
  '/about': AboutPage,
  '/browser': BrowserPage,
};

const root = document.getElementById('root')!;
const path = window.location.pathname;
const Page = routes[path] || IndexPage;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
