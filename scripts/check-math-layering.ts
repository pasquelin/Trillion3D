// The layering rule of the maths: a module of `packages/math/src` imports only modules inside it — a
// value import, a type import, a re-export or a dynamic `import()` — so the one home every other
// package reads never leads back out. Tests and fixtures of the maths may also import `node:`
// builtins, which run on Node alone. `check-cycles.ts` runs it.
import ts from 'typescript'
import { normalized } from './check-calls-normalize.ts'
import { isTestModule } from './repository-files.ts'

export const MATH_PACKAGE = 'packages/math'
export const MATH_UNIT = `${MATH_PACKAGE}/src`

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

/** What a reference the gate cannot resolve is reported as: it counts as a break, never skipped. */
const UNRESOLVED = 'unresolvable '

/** The module specifiers of `text`: imports (type ones too), re-exports, `import()` calls, `import("…").T`
 *  types, `import x = require('…')`, `/// <reference path>` and `new URL('…', import.meta.url)` asset
 *  references. A reference whose target is not a plain string, `import.meta.resolve(…)` included,
 *  is reported as `unresolvable …`: it counts as a break. */
function specifiersOf(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const text = literalText(node.arguments[0])
      found.push(text ?? UNRESOLVED + 'import()')
    } else if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'import.meta.resolve'
    ) {
      found.push(UNRESOLVED + 'import.meta.resolve()')
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      found.push(literalText(node.moduleReference.expression) ?? UNRESOLVED + 'require()')
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
        found.push(node.argument.literal.text)
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.[1]?.getText(source) === 'import.meta.url'
    ) {
      const text = literalText(node.arguments[0])
      found.push(text ?? UNRESOLVED + 'new URL()')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const { fileName } of source.referencedFiles) found.push(fileName)
  return found
}

/** Whether a relative specifier climbs above the repository root, which `normalized` would swallow. */
function climbsAboveRoot(file: string, specifier: string): boolean {
  let depth = 0
  for (const part of (file.slice(0, file.lastIndexOf('/') + 1) + specifier).split('/')) {
    if (part === '..') depth--
    else if (part !== '.' && part !== '') depth++
    if (depth < 0) return true
  }
  return false
}

/** Every import of a module of `packages/math/src` that leaves it, as `file: specifier`. */
export function mathLayeringBreaks(files: Map<string, string>): string[] {
  const breaks: string[] = []
  for (const [file, text] of files) {
    if (!file.startsWith(MATH_UNIT + '/')) continue
    // A test reads the package's own data beside its sources (`packages/math/golden`), never another package.
    const home = isTestModule(file) ? MATH_PACKAGE + '/' : MATH_UNIT + '/'
    for (const specifier of specifiersOf(file, text)) {
      const outside = specifier.startsWith(UNRESOLVED)
        ? true
        : specifier.startsWith('.')
          ? climbsAboveRoot(file, specifier) || !normalized(file, specifier).startsWith(home)
          : !(specifier.startsWith('node:') && isTestModule(file))
      if (outside) breaks.push(`${file}: ${specifier}`)
    }
  }
  return breaks
}
