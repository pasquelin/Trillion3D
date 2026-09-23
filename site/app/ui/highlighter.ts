import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('html', xml);

export type CodeLanguage = 'typescript' | 'html';

/** Highlight.js markup for `source`: the TypeScript grammar (JavaScript included) or HTML, whose
 * `<script>` bodies fall back on the JavaScript grammar. */
export function highlightCode(source: string, language: CodeLanguage = 'typescript') {
  return hljs.highlight(source, { language, ignoreIllegals: true }).value;
}
