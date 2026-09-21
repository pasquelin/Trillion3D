import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('typescript', typescript);

export function highlightCode(source) {
  return hljs.highlight(source, { language: 'typescript', ignoreIllegals: true }).value;
}
