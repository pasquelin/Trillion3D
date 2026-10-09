// The rule printer's inlining (`../generate-shared-rules.ts`): a call of a rule's function printed
// in place, among its caller's statements.
import ts from 'typescript'
import { expression, unsupported, type Target } from './printer.ts'
import { constantsOf, functionOf } from './source.ts'
import { statements } from './statements.ts'

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
