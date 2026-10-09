// The coverage-preserving alpha's arithmetic printed (\`../generate-shared-rules.ts\`): every
// function of \`coverageMath.ts\` into the mip chains' WGSL and the compiler's Rust, public in both
// when the module exports it, the module's own when it does not.
import ts from 'typescript'
import * as COVERAGE from '../../packages/sdk-browser/src/texture/coverageMath.ts'
import { type Target, expression, snake, unsupported } from './printer.ts'
import { comment, functionsOf, header, statements } from './statements.ts'

const COVERAGE_MATH = 'packages/sdk-browser/src/texture/coverageMath.ts'

/** The rule's functions, each after those it calls, and whether its module exports it. */
function coverageFunctions() {
  const declared = functionsOf(COVERAGE_MATH)
  const exports = Object.keys(COVERAGE)
  const names = declared.map(({ name }) => name)
  const functions = declared.map(({ name, node, body: source, doc }) => {
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
    return { name, source, doc, params, calls: [...calls], exported: exports.includes(name) }
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
  const blocks = coverageFunctions().map(({ name, source, doc, params, calls, exported }) => {
    const lines = statements(source.statements, { lang: 'wgsl', unsigned: true }, 0)
    const signature = params.map((p) => `${p.name}:${p.quad ? 'vec4u' : 'u32'}`).join(',')
    return `/**
${comment(doc, ' * ')}
 */
${exported ? 'export ' : ''}const ${wgslName(name)} = wgslBlock(
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

/** The Rust table of `scaled` at a chain's cutoff (`scale_table`, `coverage.rs`), built once from
 *  the printed `scaled`: a function calling `scaled` at its own `c` reads its byte there. */
const SCALE_TABLE = { name: 'bytes', type: '&[[u8; 256]; 256]' }

/** `scaled(a, c, t)` of a function of cutoff `c`, read from `SCALE_TABLE` at `[t][a]`. */
function scaleTableRead(node: ts.Expression, t: Target) {
  if (!ts.isCallExpression(node) || node.expression.getText() !== COVERAGE.scaled.name) return
  const [alpha, cutoff, bin] = node.arguments
  if (cutoff.getText() !== 'c') return unsupported(node)
  const index = (arg: ts.Expression) =>
    ts.isIdentifier(arg) || ts.isElementAccessExpression(arg)
      ? `${expression(arg, t)} as usize`
      : `(${expression(arg, t)}) as usize`
  return `u32::from(${SCALE_TABLE.name}[${index(bin)}][${index(alpha)}])`
}

export function coverageRust() {
  const functions = coverageFunctions().map(({ name, source, doc, params, calls, exported }) => {
    const table = calls.includes(COVERAGE.scaled.name)
    const target: Target = {
      lang: 'rust',
      call: snake,
      read: table ? (node) => scaleTableRead(node, target) : undefined,
    }
    const lines = statements(source.statements, target, 1, true)
    const signature = [
      ...params.map((p) => `${p.name}: ${p.quad ? '[u32; 4]' : 'u32'}`),
      ...(table ? [`${SCALE_TABLE.name}: ${SCALE_TABLE.type}`] : []),
    ].join(', ')
    const tableDoc = table
      ? `\n///\n/// In Rust: \`${COVERAGE.scaled.name}\` at \`c\` is read from \`${SCALE_TABLE.name}\`, its table built once a chain\n/// (\`scale_table\`, \`coverage.rs\`).`
      : ''
    return `${comment(doc, '/// ')}${tableDoc}
${exported ? 'pub(super) ' : ''}fn ${snake(name)}(${signature}) -> u32 {
${lines.join('\n')}
}`
  })
  return `${header([COVERAGE_MATH], '//!')}

${functions.join('\n\n')}
`
}
