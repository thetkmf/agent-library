import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

/** 渲染进程兜底：任何组件抛错时给出可读提示，而不是白屏 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { message: null };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : '未知错误' };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 仅输出到本地控制台；不落盘、不上报
    console.error('渲染失败', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.message) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md rounded-lg border border-border bg-elevated p-6 text-center">
            <h1 className="text-base font-semibold text-content">界面加载失败</h1>
            <p className="mt-2 text-sm text-muted">{this.state.message}</p>
            <button
              type="button"
              className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
