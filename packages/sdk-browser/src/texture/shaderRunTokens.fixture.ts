// The WGSL tokens `shaderRun` (`shaderRun.fixture.ts`) translates: numbers, names and operators, the
// blanks and comments skipped, a JavaScript reserved word renamed.
/** A token, or what it skips: blanks and `//` comments. */
const TOKEN =
  /\s+|\/\/[^\n]*|((?:0x[\da-f]+|\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)[uif]?|[A-Za-z_]\w*|&&|\|\||<=|>=|==|!=|>>|<<|\+\+|--|[-+*/%|&^]=|->|[-+*/%<>=!&|^~(){}[\];,.:@])/giy
const JS_RESERVED = new Set(['in', 'new', 'this', 'class', 'delete', 'typeof', 'void', 'with'])
/** `text`'s tokens, a JavaScript reserved word renamed. */
export function tokens(text: string) {
  const out: string[] = []
  TOKEN.lastIndex = 0
  for (let match; TOKEN.lastIndex < text.length;) {
    if (!(match = TOKEN.exec(text))) throw new Error(`WGSL token at ${text.slice(TOKEN.lastIndex)}`)
    if (match[1]) out.push(JS_RESERVED.has(match[1]) ? `$${match[1]}` : match[1])
  }
  return out
}
