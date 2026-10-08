// The small-helper check the block detector cannot do: a two-line `dot` copied into a second module
// stays under any block threshold. A free function of the same name, the same signature and the
// same body — comments and layout aside — defined in two non-test modules of one package or crate
// is a copy, reported with the module that should own it. The body is compared too: a driver's
// `convert` or a codec's `encode` share a name and a signature with their siblings by design and
// hold different code. A free TypeScript function anywhere in the tree whose signature and body are
// those of a `packages/math` function, whatever its name and its parameters' names, is a copy of
// the maths, a declared oracle aside (`scripts/lint-maths.ts`). `pnpm run check:helpers`;
// `scripts/check-helpers.test.ts` plants a copy.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { cfgTestModules, rsHelpers } from './check-helpers-rust.ts'
import { NATIVE_CRATES } from './native-crates.ts'
import { isMathsOracle } from './lint-maths.ts'
import { SOURCE_UNITS, isTestModule, sourceFilesOf } from './repository-files.ts'

/** Each package or crate is its own namespace: a helper is owned once per unit. */
export const UNITS = [...SOURCE_UNITS, ...NATIVE_CRATES.map((crate) => `${crate.path}/src`)]

export interface Helper {
  name: string
  signature: string
  body: string
  file: string
  /** A TypeScript helper's signature and body with its parameters renamed by position: what a copy
   *  keeps under another name. */
  anonymous?: string
}

/** The body of `fn` with each parameter bound by a plain name renamed `$0`, `$1`… by position,
 *  wherever the body reads it: a property or a key of that name is left alone. */
function positional(fn: ts.FunctionLikeDeclaration): ts.Node | undefined {
  const renamed = new Map<string, string>()
  fn.parameters.forEach((p, i) => ts.isIdentifier(p.name) && renamed.set(p.name.text, `$${i}`))
  if (!fn.body || !renamed.size) return fn.body
  const read = (node: ts.Identifier) => {
    const parent = node.parent
    return !(
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
    )
  }
  const visit = (context: ts.TransformationContext) => {
    const each = (node: ts.Node): ts.Node =>
      ts.isIdentifier(node) && renamed.has(node.text) && read(node)
        ? ts.factory.createIdentifier(renamed.get(node.text)!)
        : ts.visitEachChild(node, each, context)
    return each
  }
  return ts.transform(fn.body, [(context) => (node) => visit(context)(node) as ts.ConciseBody])
    .transformed[0]
}

/** The helpers a TypeScript module defines at its top level, read by the compiler: a function
 *  declaration, or a `const` bound to an arrow or a function expression. */
function tsHelpers(file: string, text: string): Helper[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ removeComments: true })
  const flat = (node: ts.Node | undefined) =>
    node ? printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, '') : ''
  const out: Helper[] = []
  const add = (name: string, fn: ts.FunctionLikeDeclaration, declared?: ts.TypeNode) => {
    if (!fn.body) return
    const async = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async' : ''
    const types = (fn.typeParameters ?? []).map(flat).join(',')
    const params = fn.parameters
      .map(
        (p) =>
          `${p.dotDotDotToken ? '...' : ''}${p.questionToken ? '?' : ''}${flat(p.type) || '?'}`,
      )
      .join(',')
    const signature = `${async}<${types}>(${params})=>${flat(fn.type)}:${flat(declared)}`
    // An arrow's expression body reads as the block that returns it.
    const body = positional(fn)
    const block = body && !ts.isBlock(body) ? `{return${flat(body)};}` : flat(body)
    const anonymous = `${signature}\0${block}`
    out.push({ name, signature, body: flat(fn.body), file, anonymous })
  }
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement)
    if (!ts.isVariableStatement(statement)) continue
    for (const { name, initializer, type } of statement.declarationList.declarations)
      if (
        ts.isIdentifier(name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      )
        add(name.text, initializer, type)
  }
  return out
}

const MATH_UNIT = 'packages/math/src'

/** The trees outside the packages, whose TypeScript helpers are compared with the maths alone: a
 *  declared oracle among them (`scripts/lint-maths.ts`) keeps its copies on purpose. */
const MATH_READERS = ['bench', 'scripts', 'site', 'tests']

/** Every helper of `files` (path -> text) defined twice, signature and body alike, in one unit.
 *  The maths unit is the one home the rest of the tree reads, so its helpers are also compared
 *  with those of every other TypeScript unit and of the trees outside the packages, whatever their
 *  names, and a copy is reported with the maths as its owner. */
export function duplicateHelpers(files: Map<string, string>): Helper[][] {
  const seen = new Map<string, Helper[]>()
  const add = (key: string, helper: Helper, first = false) =>
    seen.set(key, first ? [helper, ...(seen.get(key) ?? [])] : [...(seen.get(key) ?? []), helper])
  const testOnly = cfgTestModules(files)
  for (const [file, text] of files) {
    const unit = UNITS.find((u) => file.startsWith(u + '/'))
    const reader =
      !unit && /\.(?:[cm]?ts|tsx)$/.test(file) && !isMathsOracle(file)
        ? MATH_READERS.find((tree) => file.startsWith(tree + '/'))
        : undefined
    const home = unit ?? reader
    if (!home || isTestModule(file.slice(home.length))) continue
    if (testOnly.some((path) => file === path || (path.endsWith('/') && file.startsWith(path))))
      continue
    const helpers = file.endsWith('.rs') ? rsHelpers(file, text) : tsHelpers(file, text)
    for (const helper of helpers) {
      if (helper.name === 'main' || helper.name === 'default') continue
      if (unit) add(`${unit}\0${helper.name}\0${helper.signature}\0${helper.body}`, helper)
      if (file.endsWith('.rs')) continue
      const shape = helper.anonymous ?? `${helper.name}\0${helper.signature}\0${helper.body}`
      if (home !== MATH_UNIT) add(`${MATH_UNIT}>${home}\0${shape}`, helper)
      else
        for (const other of [...UNITS, ...MATH_READERS])
          if (other !== MATH_UNIT) add(`${MATH_UNIT}>${other}\0${shape}`, helper, true)
    }
  }
  const inMath = (h: Helper) => h.file.startsWith(MATH_UNIT + '/')
  return [...seen]
    .filter(
      ([key, group]) =>
        new Set(group.map((h) => h.file)).size > 1 &&
        (!key.startsWith(MATH_UNIT + '>') || (group.some(inMath) && !group.every(inMath))),
    )
    .map(([, group]) => group)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..')
  const files = sourceFilesOf(/\.(?:m?ts|rs)$/, root)
  const groups = duplicateHelpers(files)
  for (const group of groups)
    console.error(
      `${group[0].name}${group[0].signature} is defined in ${group.map((h) => h.file).join(', ')}: ` +
        `keep it in ${group[0].file} and import it`,
    )
  if (groups.length) process.exitCode = 1
  else
    console.log('No small helper is defined twice within one package, nor copied from the maths.')
}
