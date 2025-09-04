import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './pages/home';
import BrowserPage from './pages/browser';
import OfferingsPage from './pages/offerings';
import IntakePage from './pages/intake';
import DonorsPage from './pages/donors';
import DownloadsPage from './pages/downloads';
import AboutPage from './pages/about';

const root = document.getElementById('root')!;
const path = window.location.pathname.replace(/\/$/, '') || '/';

const routes: Record<string, React.FC> = {
  '/': HomePage,
  '/offerings': OfferingsPage,
  '/intake': IntakePage,
  '/donors': DonorsPage,
  '/downloads': DownloadsPage,
  '/about': AboutPage,
  '/browser': BrowserPage,
};

const Page = routes[path] || HomePage;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);
