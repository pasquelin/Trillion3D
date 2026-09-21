import { useEffect, useRef } from 'react';
import type { CodeInputProps } from '../types/components.ts';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { codeHighlight } from './codeHighlight.tsx';

/** The site's single editable JavaScript primitive, backed by CodeMirror. */
export function CodeInput({ value, onChange, label }: CodeInputProps) {
  const parent = useRef<HTMLDivElement | null>(null),
    view = useRef<EditorView | null>(null),
    change = useRef<(val: string) => void>(onChange);
  change.current = onChange;
  const initial = useRef<string>(value);
  initial.current = value;
  useEffect(() => {
    if (!parent.current) return;
    const editor = new EditorView({
      doc: initial.current,
      parent: parent.current,
      extensions: [
        basicSetup,
        javascript(),
        codeHighlight,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current(update.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [label]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="code-editor-input" ref={parent} />;
}
