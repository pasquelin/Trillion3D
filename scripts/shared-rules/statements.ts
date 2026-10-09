// The rule printer's statements (`../generate-shared-rules.ts`): a function of a rule's source,
// read from its module, and its statements in WGSL, C++ or Rust.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { type Constant, type Target, expression, trigPairs, unsupported } from './printer.ts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The module at `path`, parsed. */
function moduleOf(path: string) {
  const text = readFileSync(join(ROOT, path), 'utf8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
}

/** The documentation leading `node`, line by line. */
function docOf(node: ts.Node) {
  const text = node.getSourceFile().text
  const comment = ts.getLeadingCommentRanges(text, node.getFullStart())?.at(-1)
  return comment
    ? text
        .slice(comment.pos, comment.end)
        .replace(/^\/\*\*\s?|\s*\*\/$/g, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s*/, ''))
    : []
}

/** The functions of the module at `path`, in their order, each with its body and documentation. */
export function functionsOf(path: string) {
  return moduleOf(path)
    .statements.filter(
      (statement): statement is ts.FunctionDeclaration & { name: ts.Identifier; body: ts.Block } =>
        ts.isFunctionDeclaration(statement) && !!statement.name && !!statement.body,
    )
    .map((node) => ({
      name: node.name.text,
      node,
      body: node.body,
      doc: docOf(node),
    }))
}

/** The function `name` of the module at `path`, with its leading documentation. */
export function functionOf(path: string, name: string) {
  const found = functionsOf(path).find((fn) => fn.name === name)
  if (!found) throw new Error(`${path}: no function '${name}'`)
  return found
}

/** The numeric constants of the module at `path`, by name. */
export function constantsOf(path: string) {
  const constants = new Map<string, Constant>()
  for (const statement of moduleOf(path).statements) {
    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const item of statement.declarationList.declarations)
      if (item.initializer && ts.isNumericLiteral(item.initializer))
        constants.set(item.name.getText(), {
          value: item.initializer.text,
          doc: docOf(statement),
        })
  }
  return constants
}

/** The constants of `constants` that `node` reads, in their order there. */
export function readConstants(node: ts.Node, constants: ReadonlyMap<string, Constant>) {
  const read = new Set<string>()
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child) && constants.has(child.text)) read.add(child.text)
    child.forEachChild(visit)
  }
  visit(node)
  return [...constants].filter(([name]) => read.has(name))
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
    const items = node.declarationList.declarations.filter((item) => t.declares?.(item) ?? true)
    if (!items.length) return []
    const lines: string[] = []
    if (t.lang === 'cpp') {
      for (const angle of trigPairs(items)) {
        const pair = { sin: `sin${angle[0].toUpperCase()}${angle.slice(1)}`, cos: '' }
        pair.cos = `cos${pair.sin.slice(3)}`
        t.pairs!.set(angle, pair)
        lines.push(
          pad(`double ${pair.sin}, ${pair.cos};`),
          pad(`sinCos(${angle}, ${pair.sin}, ${pair.cos});`),
        )
      }
    }
    const declared = items.map(
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
      const slot = left.argumentExpression.getText()
      const index = Number(t.constants?.get(slot)?.value ?? slot)
      if (!Number.isInteger(index)) unsupported(left)
      const written = t.write(index, value)
      return written === undefined ? [] : [pad(written)]
    }
    const op = operatorToken.getText()
    return [
      pad(wgsl ? `${expression(left, t)}${op}${value};` : `${expression(left, t)} ${op} ${value};`),
    ]
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && t.inline)
    return t.inline(node.expression, depth)
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

/** The identifiers `node` reads. */
function identifiers(node: ts.Node, into: Set<string>) {
  if (ts.isIdentifier(node)) into.add(node.text)
  node.forEachChild((child) => void identifiers(child, into))
  return into
}

/** Whether `node` is the whole value of a declaration or an assignment, printed bare. */
const whole = (node: ts.Node) =>
  ts.isVariableDeclaration(node.parent) ||
  (ts.isBinaryExpression(node.parent) &&
    node.parent.right === node &&
    node.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment)

/**
 * `t` with the calls of function `name` of the module at `path` printed in place, its statements
 * among the caller's, every operation kept in its order: a parameter reads the caller's argument;
 * the callee's last parameter, `out`, is the array the caller passes, whose slot the caller reads
 * as the value the callee writes there; a declaration of the callee that no slot the caller reads
 * needs prints nothing, and nor does a caller's declaration of a name the callee declared, which
 * must hold the same value.
 */
export function withInlined(t: Target, path: string, name: string): Target {
  const callee = functionOf(path, name)
  const constants = constantsOf(path)
  const params = callee.node.parameters.map((param) => param.name.getText())
  if (params.at(-1) !== 'out') throw new Error(`${path}: '${name}' writes into its last, 'out'`)
  const slotOf = (node: ts.Expression) => {
    const index = Number(constants.get(node.getText())?.value ?? node.getText())
    return Number.isInteger(index) ? index : unsupported(node)
  }
  // What the callee writes at each slot, and what it declares, in their order.
  const writes = new Map<number, ts.Expression>()
  const declarations: ts.VariableDeclaration[] = []
  const gather = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node)
    if (
      ts.isBinaryExpression(node) &&
      ts.isElementAccessExpression(node.left) &&
      node.left.expression.getText() === 'out'
    )
      writes.set(slotOf(node.left.argumentExpression), node.right)
    node.forEachChild(gather)
  }
  gather(callee.body)
  // The array the caller passes, the values it reads of it and the callee's declarations printed.
  let array: string | undefined
  const values = new Map<number, string>(),
    declared = new Map<string, string>()
  const caller: Target = {
    ...t,
    read(node) {
      if (ts.isElementAccessExpression(node) && node.expression.getText() === array) {
        const value = values.get(slotOf(node.argumentExpression)) ?? unsupported(node)
        return whole(node) ? value : `(${value})`
      }
      return t.read?.(node)
    },
    declares(item) {
      const value = declared.get(item.name.getText())
      if (value === undefined) return t.declares?.(item) ?? true
      if (expression(item.initializer!, caller) !== value)
        throw new Error(`'${item.name.getText()}' is declared by '${name}' with another value`)
      return false
    },
    inline(call, depth) {
      if (call.expression.getText() !== name) return unsupported(call)
      const args = call.arguments
      array = args[params.length - 1].getText()
      let body: ts.Node = call
      while (!ts.isFunctionDeclaration(body)) body = body.parent
      const read = new Set<number>()
      const reads = (node: ts.Node) => {
        if (ts.isElementAccessExpression(node) && node.expression.getText() === array)
          read.add(slotOf(node.argumentExpression))
        node.forEachChild(reads)
      }
      reads(body)
      const needed = new Set<string>()
      for (const slot of read) identifiers(writes.get(slot) ?? unsupported(call), needed)
      for (const item of [...declarations].reverse())
        if (needed.has(item.name.getText())) identifiers(item.initializer!, needed)
      const bound = new Map(params.slice(0, -1).map((param, i) => [param, args[i]]))
      const own: Target = {
        ...caller,
        constants,
        read: (node) =>
          ts.isIdentifier(node) && bound.has(node.text)
            ? expression(bound.get(node.text)!, caller)
            : t.read?.(node),
        write(index, value) {
          if (read.has(index)) values.set(index, value)
          return undefined
        },
        declares(item) {
          const kept = needed.has(item.name.getText())
          if (kept) declared.set(item.name.getText(), expression(item.initializer!, own))
          return kept
        },
      }
      return statements(callee.body.statements, own, depth)
    },
  }
  return caller
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
