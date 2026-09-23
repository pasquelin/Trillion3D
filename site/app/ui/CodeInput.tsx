import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** The colours of the code blocks (`.mockup-code` in `syntax.css`), which follow the theme. */
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.bool, tags.null], color: 'var(--code-keyword)', fontWeight: '600' },
    { tag: [tags.string, tags.regexp, tags.attributeValue], color: 'var(--code-string)' },
    { tag: [tags.number, tags.atom, tags.attributeName], color: 'var(--code-number)' },
    {
      tag: [
        tags.function(tags.variableName),
        tags.typeName,
        tags.standard(tags.name),
        tags.tagName,
      ],
      color: 'var(--code-function)',
    },
    { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  ]),
);

/** The editor on the page's own palette: its surface, its text, no outline — the frame around it
 * shows the focus by its border. */
const look = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--color-base-content)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '0.875rem', scrollbarWidth: 'thin' },
  '.cm-gutters': {
    background: 'var(--color-base-300)',
    color: 'color-mix(in oklab, var(--color-base-content) 60%, transparent)',
    border: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    background: 'color-mix(in oklab, var(--color-base-content) 7%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-base-content)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    background: 'color-mix(in oklab, var(--color-primary) 30%, transparent) !important',
  },
});

interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/** The site’s one editable code field: a page of HTML and its scripts, in CodeMirror. It grows
 * into the column it sits in and scrolls inside it. */
export function CodeInput({ value, onChange, label }: CodeInputProps) {
  const parent = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const latest = useRef(value);
  useEffect(() => {
    change.current = onChange;
  });
  useEffect(() => {
    const editor = new EditorView({
      doc: latest.current,
      parent: parent.current!,
      extensions: [
        basicSetup,
        html(),
        highlight,
        look,
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
  // A source set from outside — the example's once fetched, the start again on Reset — replaces
  // the document; the reader's own typing is already there.
  useEffect(() => {
    latest.current = value;
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="min-h-0 flex-1" ref={parent} />;
}
