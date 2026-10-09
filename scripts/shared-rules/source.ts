// The rule printer's source (`../generate-shared-rules.ts`): a rule's module parsed, its functions
// and numeric constants, each with its leading documentation.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { Constant } from './printer.ts'

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
