import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from './session';
import { App } from './App';
import './style.css';
import './buddy.css';
import { startI18n } from './i18n';

void startI18n();

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } } });

// data router (เส้นทางเดียวรับทุกที่อยู่ — <Routes> ใน App ทำงานเหมือนเดิม) เพื่อใช้ useBlocker: ถามก่อนออกจากงานที่ยังไม่บันทึก (unsaved.tsx · HANDOFF 149)
const router = createBrowserRouter([{ path: '*', element: <SessionProvider><App /></SessionProvider> }]);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
