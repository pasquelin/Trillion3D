import { highlightCode } from '../../runtime/highlighter.js';

/** Keep multiline tokens balanced inside DaisyUI's separate numbered rows. */
export function highlightLines(source) {
  const stack = [],
    lines = [];
  let line = '';
  for (const token of highlightCode(String(source)).split(/(<span\b[^>]*>|<\/span>|\n)/g)) {
    if (token === '\n') {
      lines.push(line + '</span>'.repeat(stack.length));
      line = stack.join('');
    } else {
      if (token.startsWith('<span')) stack.push(token);
      else if (token === '</span>') stack.pop();
      line += token;
    }
  }
  lines.push(line);
  return lines;
}
