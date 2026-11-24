// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BookOpen } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton';

describe('EmptyState', () => {
  it('展示标题、描述与提示', () => {
    render(
      <EmptyState
        title="暂无笔记"
        description="创建第一条笔记试试"
        hint="支持 Markdown 与 TeX"
        icon={BookOpen}
        action={<button type="button">新建</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: '暂无笔记' })).toBeInTheDocument();
    expect(screen.getByText('创建第一条笔记试试')).toBeInTheDocument();
    expect(screen.getByText('支持 Markdown 与 TeX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('以 alert 角色播报，并可触发重试', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState description="后端未就绪" code="BACKEND_NOT_FOUND" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('后端未就绪')).toBeInTheDocument();
    expect(screen.getByText('BACKEND_NOT_FOUND')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('未提供 onRetry 时不渲染重试按钮', () => {
    render(<ErrorState description="不可恢复" />);
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull();
  });
});

describe('Skeleton', () => {
  it('骨架屏对读屏隐藏，列表骨架声明 aria-busy', () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    const list = render(<SkeletonList rows={2} />);
    expect(list.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
