import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('typescript', typescript);

/** Highlight.js markup for `source`, with the TypeScript grammar (JavaScript included). */
export function highlightCode(source: string) {
  return hljs.highlight(source, { language: 'typescript', ignoreIllegals: true }).value;
}
