import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/app/App';
import { installMocks, isMockEnabled } from '@/mocks';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import '@/styles/global.css';
import 'katex/dist/katex.min.css';

// 契约 Mock：在首次请求前装配（B2–B4 合入后移除）
if (isMockEnabled()) {
  installMocks();
  console.info('[mock] 已启用契约 Mock（src/mocks）');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少 #root 挂载节点');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
