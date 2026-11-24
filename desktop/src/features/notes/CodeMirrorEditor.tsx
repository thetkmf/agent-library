import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { cn } from '@/lib/cn';

export type EditorLanguage = 'markdown' | 'tex';

export interface CodeMirrorEditorProps {
  value: string;
  language: EditorLanguage;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'rgb(var(--pkb-elevated))',
    color: 'rgb(var(--pkb-content))',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'rgb(var(--pkb-accent))' },
  '.cm-gutters': {
    backgroundColor: 'rgb(var(--pkb-surface))',
    color: 'rgb(var(--pkb-muted))',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'rgb(var(--pkb-sunken))' },
  '.cm-activeLineGutter': { backgroundColor: 'rgb(var(--pkb-sunken))' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--pkb-accent) / 0.25)' },
  '.cm-cursor': { borderLeftColor: 'rgb(var(--pkb-accent))' },
});

function languageExtension(language: EditorLanguage) {
  return language === 'tex' ? StreamLanguage.define(stex) : markdown();
}

/**
 * CodeMirror 6 受控封装：
 * - 文档只由外部 value 初始化；用户输入通过 onChange 抛回业务层
 * - 外部 value 变化（如冲突后刷新）时整体替换，且不与正在输入的内容互相打架
 */
export function CodeMirrorEditor({
  value,
  language,
  onChange,
  placeholder,
  className,
  autoFocus = false,
}: CodeMirrorEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const languageCompartment = useRef(new Compartment());
  const initialValueRef = useRef(value);
  const initialLanguageRef = useRef(language);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.current.of(languageExtension(initialLanguageRef.current)),
          theme,
          EditorView.lineWrapping,
          placeholderExt(placeholder ?? '在此输入内容…'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) {
      view.focus();
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只初始化一次：后续同步由下面的 effect 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  return <div ref={hostRef} className={cn('h-full min-h-0 overflow-auto', className)} />;
}
