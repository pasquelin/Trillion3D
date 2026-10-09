// The coverage-preserving alpha's arithmetic printed (\`../generate-shared-rules.ts\`): every
// function of \`coverageMath.ts\` into the mip chains' WGSL and the compiler's Rust.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import * as COVERAGE from '../../packages/sdk-browser/src/texture/coverageMath.ts'
import { snake, unsupported } from './printer.ts'
import { ROOT, comment, functionOf, header, statements } from './statements.ts'

const COVERAGE_MATH = 'packages/sdk-browser/src/texture/coverageMath.ts'
const TEXTURE = 'packages/sdk-browser/src/texture'
const COVERAGE_WGSL = 'coverageMathWgsl.ts'

/** The blocks the printed WGSL's readers import, beside it in the texture folder: those alone are
 *  exported, a block only another block calls stays the module's own. */
function importedBlocks() {
  const names = new Set<string>()
  for (const entry of readdirSync(join(ROOT, TEXTURE))) {
    if (!entry.endsWith('.ts') || entry === COVERAGE_WGSL) continue
    const text = readFileSync(join(ROOT, TEXTURE, entry), 'utf8')
    if (!text.includes(`'./${COVERAGE_WGSL}'`)) continue
    const file = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest)
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      if ((statement.moduleSpecifier as ts.StringLiteral).text !== `./${COVERAGE_WGSL}`) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          names.add((element.propertyName ?? element.name).text)
    }
  }
  return names
}

/** The rule's functions, each after those it calls. */
function coverageFunctions() {
  const names = Object.keys(COVERAGE)
  const functions = names.map((name) => {
    const { node, body: source, doc } = functionOf(COVERAGE_MATH, name)
    const calls = new Set<string>()
    const visit = (child: ts.Node) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
        if (!names.includes(child.expression.text)) unsupported(child)
        calls.add(child.expression.text)
      }
      child.forEachChild(visit)
    }
    visit(source)
    const params = node.parameters.map((param) => ({
      name: param.name.getText(),
      quad: param.type?.getText() === 'Quad',
    }))
    return { name, source, doc, params, calls: [...calls] }
  })
  const ordered: typeof functions = []
  const place = (fn: (typeof functions)[number]) => {
    if (ordered.includes(fn)) return
    for (const callee of fn.calls) place(functions.find((other) => other.name === callee)!)
    ordered.push(fn)
  }
  functions.forEach(place)
  return ordered
}

const wgslName = (name: string) => `${snake(name).toUpperCase()}_WGSL`

export function coverageWgsl() {
  const imported = importedBlocks()
  const blocks = coverageFunctions().map(({ name, source, doc, params, calls }) => {
    const lines = statements(source.statements, { lang: 'wgsl', unsigned: true }, 0)
    const signature = params.map((p) => `${p.name}:${p.quad ? 'vec4u' : 'u32'}`).join(',')
    return `/**
${comment(doc, ' * ')}
 */
${imported.has(wgslName(name)) ? 'export ' : ''}const ${wgslName(name)} = wgslBlock(
  '${wgslName(name)}',
  [${calls.map(wgslName).join(', ')}],
  \`fn ${name}(${signature})->u32{${lines.join('')}}\`,
)`
  })
  return `${header([COVERAGE_MATH], '//')}
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

${blocks.join('\n\n')}
`
}

export function coverageRust() {
  const functions = coverageFunctions().map(({ name, source, doc, params }) => {
    const lines = statements(source.statements, { lang: 'rust', call: snake }, 1, true)
    const signature = params.map((p) => `${p.name}: ${p.quad ? '[u32; 4]' : 'u32'}`).join(', ')
    return `${comment(doc, '/// ')}
pub(super) fn ${snake(name)}(${signature}) -> u32 {
${lines.join('\n')}
}`
  })
  return `${header([COVERAGE_MATH], '//!')}

${functions.join('\n\n')}
`
}
