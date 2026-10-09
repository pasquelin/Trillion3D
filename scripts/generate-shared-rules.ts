// The rules the engine runs in more than one language, each written once in TypeScript and printed
// here into the others: the wave model (`packages/sdk-core/src/fluids/waves.ts`, `waveRest.ts`)
// into the GPU deformation's WGSL and the physics module's C++, and the coverage-preserving alpha
// (`packages/sdk-browser/src/texture/coverageMath.ts`) into the mip chains' WGSL and the
// compiler's Rust. The printer reads the source's own syntax tree and keeps every operation in its
// order, so each language computes what the source writes, operand for operand. `--check` (a gate
// of `pnpm run validate`) fails when a printed file is not what its source prints today.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
import ts from 'typescript'
import * as COVERAGE from '../packages/sdk-browser/src/texture/coverageMath.ts'
import { HEIGHT_ITERATIONS } from '../packages/sdk-core/src/fluids/waveRest.ts'
import { WAVE_FIELDS } from '../packages/sdk-core/src/fluids/waves.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WAVES = 'packages/sdk-core/src/fluids/waves.ts'
const WAVE_REST = 'packages/sdk-core/src/fluids/waveRest.ts'
const COVERAGE_MATH = 'packages/sdk-browser/src/texture/coverageMath.ts'

type Lang = 'wgsl' | 'cpp' | 'rust'

/** How one language prints the source. */
type Target = {
  lang: Lang
  /** Integer literals are WGSL's unsigned ones, and a four-element list a `vec4u`. */
  unsigned?: boolean
  /** What the target reads for a source expression it does not print as written. */
  read?: (node: ts.Expression) => string | undefined
  /** The statement writing `value` at `out[index]`, or `undefined` when the target gathers it. */
  write?: (index: number, value: string) => string | undefined
  /** The type of a loop counter running up to `bound`. */
  counter?: (bound: string) => string
  /** A function of the source called by its target name. */
  call?: (name: string) => string
  /** `Math.sin` and `Math.cos` of one angle a C++ statement reads together, by the angle: one
   *  argument reduction for both (`sinCos`). */
  pairs?: Map<string, { sin: string; cos: string }>
}

/** The function `name` of the module at `path`, with its leading documentation. */
function functionOf(path: string, name: string) {
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

const unsupported = (node: ts.Node): never => {
  throw new Error(`the rule printer cannot print '${node.getText()}' (${ts.SyntaxKind[node.kind]})`)
}

/** `camelCase` as `snake_case`. */
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** Whether `node` prints as one operand, needing no parentheses before a method call. */
const atomic = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  ts.isNumericLiteral(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isElementAccessExpression(node) ||
  ts.isPropertyAccessExpression(node) ||
  (ts.isCallExpression(node) && node.expression.getText() !== 'Math.trunc')

function expression(node: ts.Expression, t: Target): string {
  const own = t.read?.(node)
  if (own !== undefined) return own
  const space = t.lang === 'wgsl' ? '' : ' '
  if (ts.isNumericLiteral(node)) return t.unsigned ? `${node.getText()}u` : node.getText()
  if (ts.isIdentifier(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return `(${expression(node.expression, t)})`
  if (ts.isPrefixUnaryExpression(node))
    return `${ts.tokenToString(node.operator)}${expression(node.operand, t)}`
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText()
    return `${expression(node.left, t)}${space}${op}${space}${expression(node.right, t)}`
  }
  if (ts.isElementAccessExpression(node)) {
    const index = node.argumentExpression.getText()
    const object = expression(node.expression, t)
    return t.lang === 'wgsl' ? `${object}.${'xyzw'[Number(index)]}` : `${object}[${index}]`
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((item) => expression(item, t)).join(`,${space}`)
    return t.lang === 'wgsl' ? `vec${node.elements.length}u(${items})` : `[${items}]`
  }
  if (ts.isCallExpression(node)) return call(node, t)
  return unsupported(node)
}

function call(node: ts.CallExpression, t: Target): string {
  const callee = node.expression.getText()
  const args = [...node.arguments]
  const printed = () => args.map((arg) => expression(arg, t)).join(t.lang === 'wgsl' ? ',' : ', ')
  // An integer quotient: an unsigned division truncates; WGSL names the conversion, as its shaders
  // write a quotient they keep whole.
  if (callee === 'Math.trunc')
    return t.lang === 'wgsl' ? `u32(${expression(args[0], t)})` : expression(args[0], t)
  if (callee === 'Math.min' || callee === 'Math.max') {
    const name = callee.slice(5)
    if (t.lang !== 'rust') return `${t.lang === 'cpp' ? 'std::' : ''}${name}(${printed()})`
    const receiver = args.find((arg) => !ts.isNumericLiteral(arg)) ?? args[0]
    const other = args.find((arg) => arg !== receiver)!
    const self = expression(receiver, t)
    return `${atomic(receiver) ? self : `(${self})`}.${name}(${expression(other, t)})`
  }
  if (callee === 'Math.sin' || callee === 'Math.cos') {
    const name = callee.slice(5) as 'sin' | 'cos'
    const angle = args[0].getText()
    const pair = t.pairs?.get(angle)
    if (pair) return pair[name]
    if (t.lang === 'wgsl') return `${name}(${printed()})`
    return t.lang === 'cpp' ? `std::${name}(${printed()})` : `${expression(args[0], t)}.${name}()`
  }
  if (!ts.isIdentifier(node.expression)) return unsupported(node)
  return `${t.call ? t.call(callee) : callee}(${printed()})`
}

/** The angles of a statement whose sine and cosine it reads both. */
function trigPairs(node: ts.Node) {
  const seen = new Map<string, Set<string>>()
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && /^Math\.(sin|cos)$/.test(child.expression.getText())) {
      const angle = child.arguments[0].getText()
      seen.set(angle, (seen.get(angle) ?? new Set()).add(child.expression.getText()))
    }
    child.forEachChild(visit)
  }
  visit(node)
  return [...seen].filter(([, both]) => both.size === 2).map(([angle]) => angle)
}

/** The source statements `list` in the target, one line each, indented `depth` steps; `tail`
 *  when the list ends the function, whose last `return` Rust writes as its value. */
function statements(list: readonly ts.Statement[], t: Target, depth: number, tail = false) {
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
const comment = (doc: readonly string[], prefix: string) =>
  doc.map((line) => `${prefix}${line}`.trimEnd()).join('\n')

const header = (sources: readonly string[], prefix: string) =>
  [
    'Generated by scripts/generate-shared-rules.ts from',
    ...sources.map((source) => `  ${source}`),
    'Edit the source, then run `pnpm run generate:shared-rules`.',
  ]
    .map((line) => `${prefix} ${line}`)
    .join('\n')

// The wave model.

/** `waveTerms`, the statements of one wave's terms inside `deformWaves` (`deformWgsl.ts`): the
 *  wave's numbers are the WGSL names of its parameters, the point `p`, the sums `d` and `n`. */
function waveTermsWgsl() {
  const { body: source, doc } = functionOf(WAVES, 'waveTerms')
  const terms: string[] = []
  const lines = statements(
    source.statements,
    {
      lang: 'wgsl',
      read: (node) =>
        ts.isIdentifier(node) && /^[xz]$/.test(node.text) ? `p.${node.text}` : undefined,
      write: (index, value) => void (terms[index] = value),
    },
    0,
  )
  if (terms.length !== 6 || terms.some((term) => term === undefined))
    throw new Error(`${WAVES}: waveTerms writes six terms`)
  lines.push(`d+=vec3f(${terms.slice(0, 3).join(',')});n-=vec3f(${terms.slice(3).join(',')});`)
  return `${header([`${WAVES} (\`waveTerms\`)`], '//')}

/**
${comment(doc, ' * ')}
 *
 * In WGSL: statements over the wave's numbers (\`dx\`, \`dz\`, \`k\`, \`amplitude\`, \`lateral\`,
 * \`phase\`) at the point \`p\`, adding the displacement to \`d\` and taking the normal's terms from
 * \`n\`.
 */
export const WAVE_TERMS_WGSL = \`${lines.join('')}\`
`
}

/** The physics module's wave header: the constants, the wave's doubles and `waveRest`. */
function waveModelHeader() {
  const { body: source, doc } = functionOf(WAVE_REST, 'waveRest')
  const fields = new Set<string>(WAVE_FIELDS)
  const lines = statements(
    source.statements,
    {
      lang: 'cpp',
      read(node) {
        if (ts.isPropertyAccessExpression(node) && node.getText() === 'waves.count') return 'count'
        if (
          ts.isElementAccessExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === 'waves' &&
          fields.has(node.expression.name.text)
        )
          return `waves[${node.argumentExpression.getText()}].${node.expression.name.text}`
        return undefined
      },
      write: (index, value) => `${['restX', '', 'restZ'][index]} = ${value};`,
      counter: (bound) => (bound === 'count' ? 'uint32_t' : 'int'),
      pairs: new Map(),
    },
    1,
  )
  return `${header([WAVES, `${WAVE_REST} (\`waveRest\`)`], '//')}
#pragma once

#include <cstdint>

namespace trillion {

/// Newton iterations of the rest point (\`waveRest.ts\`).
constexpr int HEIGHT_ITERATIONS = ${HEIGHT_ITERATIONS};

/// One wave as \`jolt_wave_buffer\` takes it (\`waves.ts\` WAVE_FIELDS).
struct Wave {
  double ${WAVE_FIELDS.join(', ')};
};
/// Doubles of one wave.
constexpr uint32_t WAVE_DOUBLES = ${WAVE_FIELDS.length};

/// \`sin\` and \`cos\` of \`x\` (\`waterPlanes.cpp\`).
void sinCos(double x, double &s, double &c);

${comment(doc, '/// ')}
inline void waveRest(const Wave *waves, uint32_t count, double x, double z, double &restX,
                     double &restZ) {
${lines.join('\n')}
}

}  // namespace trillion
`
}

// The coverage-preserving alpha.

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

function coverageWgsl() {
  const blocks = coverageFunctions().map(({ name, source, doc, params, calls }) => {
    const lines = statements(source.statements, { lang: 'wgsl', unsigned: true }, 0)
    const signature = params.map((p) => `${p.name}:${p.quad ? 'vec4u' : 'u32'}`).join(',')
    return `/**
${comment(doc, ' * ')}
 */
export const ${wgslName(name)} = wgslBlock(
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

function coverageRust() {
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

// Writing, or checking.

/** `text` as the repository formats a file of `path`'s kind. */
async function formatted(path: string, text: string) {
  if (path.endsWith('.ts')) {
    const config = await prettier.resolveConfig(join(ROOT, path))
    return prettier.format(text, { ...config, filepath: join(ROOT, path) })
  }
  if (path.endsWith('.rs')) {
    const done = spawnSync('rustfmt', ['--edition', '2021'], {
      input: text,
      encoding: 'utf8',
      cwd: join(ROOT, dirname(path)),
    })
    if (done.status !== 0) throw new Error(`rustfmt refused ${path}:\n${done.stderr}`)
    return done.stdout
  }
  return text
}

const outputs: Record<string, () => string> = {
  'packages/sdk-browser/src/deformation/waveTermsWgsl.ts': waveTermsWgsl,
  'packages/physics-jolt-wasm/src/waveModel.h': waveModelHeader,
  'packages/sdk-browser/src/texture/coverageMathWgsl.ts': coverageWgsl,
  'packages/asset-compiler-rust/src/texture_preview/coverage_math.rs': coverageRust,
}

const stale: string[] = []
for (const [path, print] of Object.entries(outputs)) {
  const text = await formatted(path, print())
  if (!process.argv.includes('--check')) writeFileSync(join(ROOT, path), text)
  else if (readFileSync(join(ROOT, path), 'utf8') !== text) stale.push(path)
}
if (stale.length)
  throw new Error(
    `printed from an older source: ${stale.join(', ')}; run \`pnpm run generate:shared-rules\``,
  )
