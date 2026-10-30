import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from './session';
import { App } from './App';
import './style.css';
import './buddy.css';
import { startI18n } from './i18n';

void startI18n();

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } } });

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SessionProvider><App /></SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
