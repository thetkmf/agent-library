import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { userMessageFor } from '@/api/errors';
import { useCreateItem, type ItemType } from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Panel } from '@/components/ui/Panel';
import { CodeMirrorEditor } from './CodeMirrorEditor';

const TYPE_OPTIONS: Array<{ value: Extract<ItemType, 'note' | 'tex'>; label: string; hint: string }> = [
  { value: 'note', label: '笔记', hint: 'Markdown 语法，支持分屏预览' },
  { value: 'tex', label: 'TeX', hint: '单条公式或推导，实时渲染' },
];

/** 新建条目（F3）：创建后类型不可改，幂等键保证重复提交只建一条 */
export function NewNotePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [type, setType] = useState<Extract<ItemType, 'note' | 'tex'>>(
    searchParams.get('type') === 'tex' ? 'tex' : 'note',
  );
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const createItem = useCreateItem();
  // 同一个页面实例复用同一个幂等键：重复点击不会创建多条
  const idempotencyKey = useRef(crypto.randomUUID());

  const submit = (): void => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
      setValidationError('标题长度需为 1–200 字符');
      return;
    }
    if (content.trim().length === 0) {
      setValidationError('正文不能为空');
      return;
    }
    setValidationError(null);
    createItem.mutate(
      {
        input: { type, title: trimmedTitle, content },
        idempotencyKey: idempotencyKey.current,
      },
      {
        onSuccess: (item) => navigate(`/notes/${item.id}`, { replace: true }),
      },
    );
  };

  return (
    <Panel
      title="新建条目"
      description="创建后类型不可修改；正文会自动保存"
      actions={
        <>
          <Button size="sm" onClick={() => navigate('/notes')}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={submit}
            disabled={createItem.isPending}
            data-testid="create-submit"
          >
            {createItem.isPending ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">类型</legend>
          <div className="flex gap-2">
            {TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex flex-1 cursor-pointer flex-col gap-0.5 rounded border px-3 py-2 text-xs transition-colors duration-ui ${
                  type === option.value
                    ? 'border-accent bg-accent/10 text-content'
                    : 'border-border bg-elevated text-muted hover:bg-sunken'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="item-type"
                    value={option.value}
                    checked={type === option.value}
                    onChange={() => setType(option.value)}
                    className="accent-[rgb(var(--pkb-accent))]"
                  />
                  <span className="font-medium">{option.label}</span>
                </span>
                <span className="pl-5">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="item-title" className="mb-1 block text-xs font-medium text-muted">
            标题（1–200 字符）
          </label>
          <input
            id="item-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder={type === 'tex' ? '例如：贝叶斯公式' : '例如：向量检索笔记'}
            className="w-full rounded border border-border bg-elevated px-3 py-2 text-sm text-content outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted">正文</span>
          <div className="h-64 overflow-hidden rounded border border-border">
            <CodeMirrorEditor
              value={content}
              language={type === 'tex' ? 'tex' : 'markdown'}
              onChange={setContent}
              placeholder={type === 'tex' ? 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}' : '# 标题\n\n开始记录…'}
              autoFocus
            />
          </div>
        </div>

        {validationError ? (
          <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
            {validationError}
          </p>
        ) : null}

        {createItem.isError ? (
          <ErrorState
            description={userMessageFor(createItem.error)}
            onRetry={submit}
            retryLabel="重新创建"
          />
        ) : null}
      </div>
    </Panel>
  );
}
