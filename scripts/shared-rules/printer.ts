// The rule printer's expressions (`../generate-shared-rules.ts`): a TypeScript expression of a
// rule's source in WGSL, C++ or Rust, every operation kept in its order.
import ts from 'typescript'

type Lang = 'wgsl' | 'cpp' | 'rust'

/** How one language prints the source. */
export type Target = {
  lang: Lang
  /** Integer literals are WGSL's unsigned ones, and a four-element list a `vec4u`. */
  unsigned?: boolean
  /** What the target reads for a source expression it does not print as written. */
  read?: (node: ts.Expression) => string | undefined
  /** The statement writing `value` at `out[index]`, or `undefined` when the target gathers it. */
  write?: (index: number, value: string) => string | undefined
  /** The type of a loop counter running up to `bound`. */
  counter?: (bound: string) => string
  /** A function of the source called by its target name. */
  call?: (name: string) => string
  /** `Math.sin` and `Math.cos` of one angle a C++ statement reads together, by the angle: one
   *  argument reduction for both (`sinCos`). */
  pairs?: Map<string, { sin: string; cos: string }>
}

export const unsupported = (node: ts.Node): never => {
  throw new Error(`the rule printer cannot print '${node.getText()}' (${ts.SyntaxKind[node.kind]})`)
}

/** `camelCase` as `snake_case`. */
export const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** Whether `node` prints as one operand, needing no parentheses before a method call. */
const atomic = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  ts.isNumericLiteral(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isElementAccessExpression(node) ||
  ts.isPropertyAccessExpression(node) ||
  (ts.isCallExpression(node) && node.expression.getText() !== 'Math.trunc')

export function expression(node: ts.Expression, t: Target): string {
  const own = t.read?.(node)
  if (own !== undefined) return own
  const space = t.lang === 'wgsl' ? '' : ' '
  if (ts.isNumericLiteral(node)) return t.unsigned ? `${node.getText()}u` : node.getText()
  if (ts.isIdentifier(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return `(${expression(node.expression, t)})`
  if (ts.isPrefixUnaryExpression(node))
    return `${ts.tokenToString(node.operator)}${expression(node.operand, t)}`
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText()
    return `${expression(node.left, t)}${space}${op}${space}${expression(node.right, t)}`
  }
  if (ts.isElementAccessExpression(node)) {
    const index = node.argumentExpression.getText()
    const object = expression(node.expression, t)
    return t.lang === 'wgsl' ? `${object}.${'xyzw'[Number(index)]}` : `${object}[${index}]`
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((item) => expression(item, t)).join(`,${space}`)
    return t.lang === 'wgsl' ? `vec${node.elements.length}u(${items})` : `[${items}]`
  }
  if (ts.isCallExpression(node)) return call(node, t)
  return unsupported(node)
}

function call(node: ts.CallExpression, t: Target): string {
  const callee = node.expression.getText()
  const args = [...node.arguments]
  const printed = () => args.map((arg) => expression(arg, t)).join(t.lang === 'wgsl' ? ',' : ', ')
  // An integer quotient: an unsigned division truncates; WGSL names the conversion, as its shaders
  // write a quotient they keep whole.
  if (callee === 'Math.trunc')
    return t.lang === 'wgsl' ? `u32(${expression(args[0], t)})` : expression(args[0], t)
  if (callee === 'Math.min' || callee === 'Math.max') {
    const name = callee.slice(5)
    if (t.lang !== 'rust') return `${t.lang === 'cpp' ? 'std::' : ''}${name}(${printed()})`
    const receiver = args.find((arg) => !ts.isNumericLiteral(arg)) ?? args[0]
    const other = args.find((arg) => arg !== receiver)!
    const self = expression(receiver, t)
    return `${atomic(receiver) ? self : `(${self})`}.${name}(${expression(other, t)})`
  }
  if (callee === 'Math.sin' || callee === 'Math.cos') {
    const name = callee.slice(5) as 'sin' | 'cos'
    const angle = args[0].getText()
    const pair = t.pairs?.get(angle)
    if (pair) return pair[name]
    if (t.lang === 'wgsl') return `${name}(${printed()})`
    return t.lang === 'cpp' ? `std::${name}(${printed()})` : `${expression(args[0], t)}.${name}()`
  }
  if (!ts.isIdentifier(node.expression)) return unsupported(node)
  return `${t.call ? t.call(callee) : callee}(${printed()})`
}

/** The angles of a statement whose sine and cosine it reads both. */
export function trigPairs(node: ts.Node) {
  const seen = new Map<string, Set<string>>()
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && /^Math\.(sin|cos)$/.test(child.expression.getText())) {
      const angle = child.arguments[0].getText()
      seen.set(angle, (seen.get(angle) ?? new Set()).add(child.expression.getText()))
    }
    child.forEachChild(visit)
  }
  visit(node)
  return [...seen].filter(([, both]) => both.size === 2).map(([angle]) => angle)
}
