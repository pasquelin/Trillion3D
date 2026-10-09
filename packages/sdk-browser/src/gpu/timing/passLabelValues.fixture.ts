// The labels a pass can begin with, read from the engine's source (`passLabels.test.ts`): a
// literal, a constant of a module, a template or a choice of them, or a parameter its callers fill.
import {
  argumentSpans,
  argumentsOf,
  closingQuote,
  expressionAt,
  moduleOf,
  modules,
} from './passSource.fixture.ts'

/** A part of a label the scan cannot read: a label holding one names no row of the table. */
export const UNREAD = '\u0000'
/** How deep a label is followed through constants, templates and callers. */
const MAX_DEPTH = 8

/** The callers' values of parameter `index` of the function or constructor declared at `at`. */
function callerValues(file: string, text: string, at: number, index: number, depth: number) {
  const head = text.slice(at)
  const fn = /^function\*?\s+(\w+)/.exec(head)?.[1]
  const owner = fn ?? [...text.slice(0, at).matchAll(/\bclass\s+(\w+)/g)].at(-1)?.[1]
  if (!owner) return [UNREAD]
  const call = fn
    ? new RegExp(String.raw`(?<![\w.$]|function\*?\s)${fn}\(`, 'g')
    : new RegExp(String.raw`\bnew\s+${owner}\(`, 'g')
  const exported = fn
    ? new RegExp(String.raw`\bexport\s+(?:async\s+)?function\*?\s+${fn}\b`).test(text)
    : new RegExp(String.raw`\bexport\s+class\s+${owner}\b`).test(text)
  const callers: Array<[string, string]> = exported ? [...modules] : [[file, text]]
  const values: string[] = []
  for (const [caller, body] of callers)
    for (const site of body.matchAll(call)) {
      const span = argumentSpans(body, site.index + site[0].length - 1)[index]
      values.push(
        ...(span ? valuesOf(caller, body, body.slice(...span), site.index, depth + 1) : [UNREAD]),
      )
    }
  return values.length ? values : [UNREAD]
}

/** The values the name `expr` can hold at `at`: a property's string, a binding of the module, an
 *  import's constant, or a parameter of the function declared nearest before it. */
function nameValues(file: string, text: string, expr: string, at: number, depth: number) {
  const name = expr.split('.').pop()!
  if (expr.includes('.')) {
    const strings = [
      ...text.matchAll(
        new RegExp(String.raw`(?:\b${name}\s*:|\.${name}\s*=(?!=))\s*(?=['"\x60])`, 'g'),
      ),
    ]
    return strings.length
      ? strings.flatMap((m) =>
          valuesOf(file, text, expressionAt(text, m.index + m[0].length), m.index, depth + 1),
        )
      : [UNREAD]
  }
  const bindings = [
    ...text.matchAll(
      new RegExp(
        String.raw`(?:\b(?:const|let|var)\s+|,\s*\n\s*)${name}\b(?:\s*:[^=\n]*)?\s*=(?![=>])`,
        'g',
      ),
    ),
  ]
  const binding = bindings.filter((m) => m.index < at).at(-1) ?? bindings[0]
  if (binding)
    return valuesOf(
      file,
      text,
      expressionAt(text, binding.index + binding[0].length),
      at,
      depth + 1,
    )
  for (const imported of text.matchAll(/\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (!new RegExp(String.raw`\b${name}\b`).test(imported[1])) continue
    const original = new RegExp(String.raw`(\w+)\s+as\s+${name}\b`).exec(imported[1])?.[1] ?? name
    const target = moduleOf(file, imported[2]),
      body = modules.get(target)
    const constant =
      body &&
      new RegExp(String.raw`\bexport\s+const\s+${original}\b(?:\s*:[^=\n]*)?\s*=`).exec(body)
    return constant
      ? valuesOf(
          target,
          body,
          expressionAt(body, constant.index + constant[0].length),
          0,
          depth + 1,
        )
      : [UNREAD]
  }
  const enclosing = [
    ...text.slice(0, at).matchAll(/(?:\bfunction\*?\s+\w+\s*|\bconstructor\s*)\(/g),
  ].reverse()
  for (const opening of enclosing) {
    const params = argumentsOf(text, opening.index + opening[0].length - 1)
    const index = params.findIndex((param) =>
      new RegExp(String.raw`^\s*(?:(?:private|public|protected|readonly)\s+)*${name}\b`).test(
        param,
      ),
    )
    if (index >= 0) return callerValues(file, text, opening.index, index, depth)
  }
  return [UNREAD]
}

/** The `${…}` parts and the text between them of the template literal `expr`, filled. */
function templateValues(file: string, text: string, expr: string, at: number, depth: number) {
  let values = [''],
    chunk = ''
  for (let i = 1; i < expr.length - 1; i++) {
    if (expr[i] === '\\') chunk += expr[++i]
    else if (expr[i] === '$' && expr[i + 1] === '{') {
      let j = i + 1
      for (let inner = 0; j < expr.length; j++) {
        const c = expr[j]
        if (c === "'" || c === '"' || c === '`') j = closingQuote(expr, j)
        else if (c === '{') inner++
        else if (c === '}' && --inner === 0) break
      }
      const parts = valuesOf(file, text, expr.slice(i + 2, j), at, depth + 1),
        head = chunk
      values = values.flatMap((value) => parts.map((part) => value + head + part))
      chunk = ''
      i = j
    } else chunk += expr[i]
  }
  return values.map((value) => value + chunk)
}

/** The two branches of the top-level conditional `expr`, or `null` when it is none. */
function branchesOf(expr: string): [string, string] | null {
  let depth = 0,
    question = -1,
    nested = 0
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (c === "'" || c === '"' || c === '`') i = closingQuote(expr, i)
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth) continue
    else if (c === '?' && !'.?'.includes(expr[i + 1]) && expr[i - 1] !== '?') {
      if (question < 0) question = i
      else nested++
    } else if (c === ':' && question >= 0) {
      if (!nested) return [expr.slice(question + 1, i), expr.slice(i + 1)]
      nested--
    }
  }
  return null
}

/** Every string the label expression `raw` of `file` can be at `at`; a part the scan cannot read
 *  is `UNREAD`. */
function valuesOf(file: string, text: string, raw: string, at: number, depth = 0): string[] {
  const expr = raw
    .trim()
    .replace(/!$/, '')
    .replace(/\s+as\s+[\w.]+$/, '')
  if (depth > MAX_DEPTH) return [UNREAD]
  const literal = /^'([^'\\]*)'$|^"([^"\\]*)"$/.exec(expr)
  if (literal) return [literal[1] ?? literal[2]]
  const branches = branchesOf(expr)
  if (branches) return branches.flatMap((branch) => valuesOf(file, text, branch, at, depth + 1))
  if (expr.startsWith('`') && closingQuote(expr, 0) === expr.length - 1)
    return templateValues(file, text, expr, at, depth)
  if (/^(?:this\.)?[\w$]+(?:\.[\w$]+)*$/.test(expr)) return nameValues(file, text, expr, at, depth)
  return [UNREAD]
}

/** The labels the descriptor whose `{` is at `open` can carry. */
export function labelsOf(file: string, text: string, open: number) {
  const opening = /^\{\s*label\b\s*(:)?/.exec(text.slice(open))!
  return opening[1]
    ? valuesOf(file, text, expressionAt(text, open + opening[0].length), open)
    : valuesOf(file, text, 'label', open)
}
