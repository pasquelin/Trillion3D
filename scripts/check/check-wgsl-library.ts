// A shader lists the WGSL library's declarations (`packages/math/src/wgsl/`), never writes one again:
// a module of the tree whose strings or templates declare a function, a constant or a structure
// under a library name holds a second formula, reported with that name. The maths themselves and
// the declared oracles (`scripts/lint/lint-maths.ts`) are not read. A standalone `.wgsl` file, which
// a crate loads and which cannot list the library, may carry a library declaration only as its
// exact twin: the same text, comments and layout aside; any other declaration under that name is
// reported. Vendored shaders are not read. `pnpm run check:wgsl-library`;
// `scripts/check/check-wgsl-library.test.ts` plants a declaration.
import { matchesGlob } from 'node:path'
import ts from 'typescript'
import type { WgslDecl } from '../../packages/math/src/wgsl/decl.ts'
import { WGSL_LIBRARY } from '../../packages/math/src/wgsl/library.fixture.ts'
import { MATHS_HOME, isMathsOracle } from '../lint/lint-maths.ts'
import { sourceFilesOf } from '../git/repository-files.ts'

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

/** The declarations of `library` that name a WGSL identifier, a fragment's name being none. */
const namedOf = (library: readonly WgslDecl[]) => library.filter((decl) => decl.kind !== 'block')

/** A WGSL declaration of one of `library`'s names: its kind, then its name. */
const declarationsOf = (library: readonly WgslDecl[]) =>
  new RegExp(
    `\\b(fn|const|struct)\\s+(${namedOf(library)
      .map((decl) => decl.name)
      .join('|')})\\b`,
    'g',
  )

/** Each `file: kind name` of `files` (path -> text) that declares a name of `library` in its WGSL,
 *  outside the maths and the oracles, test modules among them. */
export function libraryRedeclarations(
  files: Map<string, string>,
  library: readonly WgslDecl[] = WGSL_LIBRARY,
): string[] {
  const declares = declarationsOf(library)
  const found: string[] = []
  for (const [file, text] of files) {
    if (matchesGlob(file, MATHS_HOME) || isMathsOracle(file)) continue
    for (const wgsl of stringTexts(file, text))
      for (const [, kind, name] of wgsl.matchAll(declares)) found.push(`${file}: ${kind} ${name}`)
  }
  return [...new Set(found)]
}

/** `text` without its comments, so a brace or a name in one is not read as code. */
const withoutComments = (text: string) => text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')

/** `text` without its comments and its white space, each decimal literal as the `f32` it stands
 *  for: what two layouts of one declaration share. */
const bare = (text: string) =>
  withoutComments(text)
    .replace(/\s+/g, '')
    .replace(/(?<![\w.])(?:\d+\.\d*|\.\d+|\d+(?=[ef]))(?:e[+-]?\d+)?f?(?![\w.])/gi, (n) =>
      String(Math.fround(Number(n.replace(/f$/i, '')))),
    )

/** The declaration starting at `at` of `text`: a function or a structure to its closing brace, a
 *  constant to its semicolon. */
function declarationAt(text: string, at: number, kind: string): string {
  if (kind === 'const') {
    const end = text.indexOf(';', at)
    return end < 0 ? text.slice(at) : text.slice(at, end + 1)
  }
  let depth = 0
  for (let i = text.indexOf('{', at); i >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1)
  }
  return text.slice(at)
}

/** Each `file: kind name` of the standalone shaders `files` (path -> text) that declares a name of
 *  `library` with any text but the library's own. */
export function wgslFileRedeclarations(
  files: Map<string, string>,
  library: readonly WgslDecl[] = WGSL_LIBRARY,
): string[] {
  const own = new Map(namedOf(library).map((decl) => [decl.name, bare(decl.text)]))
  const declares = declarationsOf(library)
  const found: string[] = []
  for (const [file, text] of files) {
    if (file.includes('/vendor/')) continue
    const code = withoutComments(text)
    for (const match of code.matchAll(declares)) {
      const [, kind, name] = match
      if (bare(declarationAt(code, match.index, kind)) !== own.get(name))
        found.push(`${file}: ${kind} ${name}`)
    }
  }
  return [...new Set(found)]
}

if (import.meta.main) {
  const found = libraryRedeclarations(sourceFilesOf(/\.[cm]?ts$/))
  const twins = wgslFileRedeclarations(sourceFilesOf(/\.wgsl$/))
  for (const line of found)
    console.error(`${line} is the WGSL library's: list its declaration instead of writing it`)
  for (const line of twins)
    console.error(`${line} is the WGSL library's: write the library's text or another name`)
  if (found.length || twins.length) process.exitCode = 1
  else console.log('No shader declares a name of the WGSL library.')
}
