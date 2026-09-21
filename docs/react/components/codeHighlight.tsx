import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Both code views resolve colours through the shared CodeSurface CSS palette. */
export const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.bool, tags.null], color: 'var(--code-keyword)', fontWeight: '600' },
    { tag: [tags.string, tags.regexp], color: 'var(--code-string)' },
    { tag: [tags.number, tags.atom], color: 'var(--code-number)' },
    {
      tag: [tags.function(tags.variableName), tags.typeName, tags.standard(tags.name)],
      color: 'var(--code-function)',
    },
    { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  ]),
);
