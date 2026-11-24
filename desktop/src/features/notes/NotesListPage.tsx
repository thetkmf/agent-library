import { Link } from 'react-router-dom';
import { BookOpen, FilePlus2, Sigma } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { useItems, type Item, type ItemType } from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LinkButton } from '@/components/ui/LinkButton';
import { SkeletonList } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/lib/format';
import { isMockEnabled } from '@/mocks';

const TYPE_LABEL: Record<ItemType, string> = {
  note: '笔记',
  tex: 'TeX',
  file: '文件',
};

const TYPE_TONE: Record<ItemType, string> = {
  note: 'border-accent/30 bg-accent/10 text-accent',
  tex: 'border-success/30 bg-success/10 text-success',
  file: 'border-border bg-sunken text-muted',
};

function ItemRow({ item }: { item: Item }): JSX.Element {
  return (
    <li>
      <Link
        to={`/notes/${item.id}`}
        className="block rounded-lg border border-border bg-elevated px-4 py-3 transition-colors duration-ui hover:border-accent/40 hover:bg-sunken focus-visible:border-accent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] leading-none ${TYPE_TONE[item.type]}`}>
                {TYPE_LABEL[item.type]}
              </span>
              <h3 className="truncate text-sm font-medium text-content">{item.title}</h3>
            </div>
            {item.preview ? (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{item.preview}</p>
            ) : null}
            {item.tags.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="标签">
                {item.tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted"
                  >
                    {tag.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="shrink-0 text-right text-[11px] text-muted">
            <div>{formatRelativeTime(item.updated_at)}</div>
            <div className="mt-0.5">v{item.version}</div>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** 笔记列表（F3）：新建入口 + 列表状态（加载 / 空 / 错误） */
export function NotesListPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useItems({ page_size: 50 });

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">全部条目</h2>
          {data ? <span className="text-xs text-muted">{data.total} 条</span> : null}
          {isMockEnabled() ? (
            <span
              className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
              title="Mock 数据来自 src/mocks，B2 合入后可删除"
            >
              Mock
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <LinkButton size="sm" to="/notes/new?type=tex">
            <Sigma className="h-3.5 w-3.5" aria-hidden="true" />
            新建 TeX
          </LinkButton>
          <LinkButton size="sm" variant="primary" to="/notes/new?type=note">
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
            新建笔记
          </LinkButton>
        </div>
      </div>

      {isPending ? <SkeletonList rows={4} /> : null}

      {isError ? (
        <ErrorState
          description={userMessageFor(error)}
          onRetry={() => void refetch()}
          retryLabel="重新加载"
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="还没有条目"
          description="创建第一条笔记或 TeX 便签，内容会保存在本机。"
          action={
            <Button variant="primary" size="sm" onClick={() => void refetch()}>
              刷新列表
            </Button>
          }
          hint="数据目录：由主进程管理，系统状态页可查看"
          className="py-14"
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}

      {data?.has_more ? (
        <p className="text-center text-xs text-muted">
          仅显示前 {data.items.length} 条，共 {data.total} 条
        </p>
      ) : null}
    </>
  );
}
