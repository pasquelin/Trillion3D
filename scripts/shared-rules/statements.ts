// The rule printer's statements (`../generate-shared-rules.ts`): a function of a rule's source,
// read from its module, and its statements in WGSL, C++ or Rust.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { type Target, expression, trigPairs, unsupported } from './printer.ts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The function `name` of the module at `path`, with its leading documentation. */
export function functionOf(path: string, name: string) {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const node = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!node?.body) throw new Error(`${path}: no function '${name}'`)
  const comment = ts.getLeadingCommentRanges(text, node.getFullStart())?.at(-1)
  const doc = comment
    ? text
        .slice(comment.pos, comment.end)
        .replace(/^\/\*\*\s?|\s*\*\/$/g, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s*/, ''))
    : []
  return { node, body: node.body, doc }
}

/** The source statements `list` in the target, one line each, indented `depth` steps; `tail`
 *  when the list ends the function, whose last `return` Rust writes as its value. */
export function statements(list: readonly ts.Statement[], t: Target, depth: number, tail = false) {
  const lines: string[] = []
  list.forEach((node, i) => lines.push(...statement(node, t, depth, tail && i === list.length - 1)))
  return lines
}

function body(node: ts.Statement, t: Target, depth: number) {
  return statements(ts.isBlock(node) ? node.statements : [node], t, depth)
}

function statement(node: ts.Statement, t: Target, depth: number, tail: boolean): string[] {
  // WGSL is printed on one line, as the engine's shader text is.
  const pad = (line: string) => (t.lang === 'wgsl' ? line : `${'  '.repeat(depth)}${line}`)
  const wgsl = t.lang === 'wgsl',
    rust = t.lang === 'rust'
  if (ts.isVariableStatement(node)) {
    const constant = (node.declarationList.flags & ts.NodeFlags.Const) !== 0
    const lines: string[] = []
    if (t.lang === 'cpp') {
      for (const angle of trigPairs(node)) {
        const pair = { sin: `sin${angle[0].toUpperCase()}${angle.slice(1)}`, cos: '' }
        pair.cos = `cos${pair.sin.slice(3)}`
        t.pairs!.set(angle, pair)
        lines.push(
          pad(`double ${pair.sin}, ${pair.cos};`),
          pad(`sinCos(${angle}, ${pair.sin}, ${pair.cos});`),
        )
      }
    }
    const declared = node.declarationList.declarations.map(
      (item) => [item.name.getText(), expression(item.initializer!, t)] as const,
    )
    t.pairs?.clear()
    if (wgsl)
      return [
        pad(
          declared.map(([name, value]) => `${constant ? 'let' : 'var'} ${name}=${value};`).join(''),
        ),
      ]
    if (rust)
      return declared.map(([name, value]) =>
        pad(`let ${constant ? '' : 'mut '}${name} = ${value};`),
      )
    const list = declared.map(([name, value]) => `${name} = ${value}`).join(', ')
    return [...lines, pad(`${constant ? 'const double' : 'double'} ${list};`)]
  }
  if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
    const { left, right, operatorToken } = node.expression
    const value = expression(right, t)
    if (ts.isElementAccessExpression(left) && left.expression.getText() === 'out' && t.write) {
      const written = t.write(Number(left.argumentExpression.getText()), value)
      return written === undefined ? [] : [pad(written)]
    }
    const op = operatorToken.getText()
    return [
      pad(wgsl ? `${expression(left, t)}${op}${value};` : `${expression(left, t)} ${op} ${value};`),
    ]
  }
  if (ts.isIfStatement(node)) {
    const condition = expression(node.expression, t)
    const open = wgsl ? `if(${condition}){` : rust ? `if ${condition} {` : `if (${condition}) {`
    const lines = [pad(open), ...body(node.thenStatement, t, depth + 1)]
    if (node.elseStatement)
      lines.push(pad(wgsl ? '}else{' : '} else {'), ...body(node.elseStatement, t, depth + 1))
    return [...lines, pad('}')]
  }
  if (ts.isWhileStatement(node)) {
    const condition = expression(node.expression, t)
    const open = wgsl
      ? `while(${condition}){`
      : rust
        ? `while ${condition} {`
        : `while (${condition}) {`
    return [pad(open), ...body(node.statement, t, depth + 1), pad('}')]
  }
  if (ts.isForStatement(node)) {
    const init = node.initializer as ts.VariableDeclarationList
    const counter = init.declarations[0].name.getText()
    const condition = node.condition as ts.BinaryExpression
    const bound = expression(condition.right, t)
    const open = wgsl
      ? `for(var ${counter}=0u;${counter}<${bound};${counter}++){`
      : rust
        ? `for ${counter} in 0..${bound} {`
        : `for (${t.counter!(bound)} ${counter} = 0; ${counter} < ${bound}; ${counter}++) {`
    return [pad(open), ...body(node.statement, t, depth + 1), pad('}')]
  }
  if (ts.isContinueStatement(node)) return [pad('continue;')]
  if (ts.isReturnStatement(node)) {
    if (!node.expression || node.expression.getText() === 'out') return []
    const value = expression(node.expression, t)
    return [pad(rust && tail ? value : `return ${value};`)]
  }
  return unsupported(node)
}

/** `doc` as comment lines opening with `prefix`. */
export const comment = (doc: readonly string[], prefix: string) =>
  doc.map((line) => `${prefix}${line}`.trimEnd()).join('\n')

export const header = (sources: readonly string[], prefix: string) =>
  [
    'Generated by scripts/generate-shared-rules.ts from',
    ...sources.map((source) => `  ${source}`),
    'Edit the source, then run `pnpm run generate:shared-rules`.',
  ]
    .map((line) => `${prefix} ${line}`)
    .join('\n')
