import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MAX_FILE_LIMIT_BYTES, SMALL_FILE_LIMIT_BYTES, formatSize } from './file-validation';

export interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** 是否允许多选，默认 true */
  multiple?: boolean;
}

/** 拖拽 + 选择上传区域：原生 label 关联 input，键盘可达 */
export function FileDropZone({ onFiles, disabled = false, multiple = true }: FileDropZoneProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null): void => {
    if (!list || list.length === 0) {
      return;
    }
    onFiles(Array.from(list));
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-ui',
        dragging ? 'border-accent bg-accent/5' : 'border-border bg-elevated',
        disabled && 'opacity-60',
      )}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) {
          return;
        }
        handleFiles(event.dataTransfer.files);
      }}
      data-testid="file-drop-zone"
    >
      <UploadCloud className="h-6 w-6 text-muted" aria-hidden="true" />
      <p className="text-sm text-content">拖拽文件到这里，或手动选择</p>
      <p className="text-[11px] text-muted">
        超过 {formatSize(SMALL_FILE_LIMIT_BYTES)} 自动分片上传（单文件上限 {formatSize(MAX_FILE_LIMIT_BYTES)}）；类型由设置中的白名单决定
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="sr-only"
        aria-label="选择要上传的文件"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={disabled}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        选择文件
      </Button>
    </div>
  );
}
