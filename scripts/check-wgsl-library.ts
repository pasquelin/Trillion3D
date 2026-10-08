// A shader lists the WGSL library's declarations (`packages/math/src/wgsl/`), never writes one again:
// a module of the tree whose strings or templates declare a function, a constant or a structure
// under a library name holds a second formula, reported with that name. The maths themselves and
// the declared oracles (`scripts/lint-maths.ts`) are not read. `pnpm run check:wgsl-library`;
// `scripts/check-wgsl-library.test.ts` plants a declaration.
import { matchesGlob } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { WgslDecl } from '../packages/math/src/wgsl/decl.ts'
import { WGSL_LIBRARY } from '../packages/math/src/wgsl/library.fixture.ts'
import { MATHS_HOME, isMathsOracle } from './lint-maths.ts'
import { sourceFilesOf } from './repository-files.ts'

/** The text of every string and template of a TypeScript module, where its WGSL is written; a
 *  template's substitutions read as a space. */
function stringTexts(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text)
    else if (ts.isTemplateExpression(node))
      found.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' '))
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Each `file: kind name` of `files` (path -> text) that declares a name of `library` in its WGSL,
 *  outside the maths and the oracles, test modules among them. */
export function libraryRedeclarations(
  files: Map<string, string>,
  library: readonly WgslDecl[] = WGSL_LIBRARY,
): string[] {
  const names = library.filter((decl) => decl.kind !== 'block').map((decl) => decl.name)
  const declares = new RegExp(`\\b(fn|const|struct)\\s+(${names.join('|')})\\b`, 'g')
  const found: string[] = []
  for (const [file, text] of files) {
    if (matchesGlob(file, MATHS_HOME) || isMathsOracle(file)) continue
    for (const wgsl of stringTexts(file, text))
      for (const [, kind, name] of wgsl.matchAll(declares)) found.push(`${file}: ${kind} ${name}`)
  }
  return [...new Set(found)]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = libraryRedeclarations(sourceFilesOf(/\.(?:[cm]?ts|tsx)$/))
  for (const line of found)
    console.error(`${line} is the WGSL library's: list its declaration instead of writing it`)
  if (found.length) process.exitCode = 1
  else console.log('No shader declares a name of the WGSL library.')
}
