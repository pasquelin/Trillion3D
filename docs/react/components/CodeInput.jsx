import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';

/** The site's single editable JavaScript primitive, backed by CodeMirror. */
export function CodeInput({ value, onChange, label }) {
  const parent = useRef(null),
    view = useRef(null),
    change = useRef(onChange);
  change.current = onChange;
  const initial = useRef(value);
  initial.current = value;
  useEffect(() => {
    const editor = new EditorView({
      doc: initial.current,
      parent: parent.current,
      extensions: [
        basicSetup,
        javascript(),
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
