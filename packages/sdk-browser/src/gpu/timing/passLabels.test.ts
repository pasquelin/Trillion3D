// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and the profile files a span by that label alone (`../../stage/passTable.ts`).
// Every pass the engine begins is read here from the source: its descriptor, inline or declared
// before the call in the same module, opens with its label, and that label — a literal, a constant
// of a module, a template or a choice of them, or a parameter its callers fill — is a row of the
// pass table, or a virtual shadow map pass by its prefix. A new pass without a label, or with one
// the table does not name, fails this test, never the ranking nor the profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { gpuPassStageOf } from '../../stage/mapping.ts'
import { VSM_PASS_PREFIX } from '../../stage/passLabels.ts'

const source = new URL('../../', import.meta.url)
/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts'
/** A descriptor opens with its label: `{ label: …, … }`, whatever the spacing. */
const LABEL_FIRST = new RegExp(String.raw`^\s*\{\s*label\b`)
/** A part of a label the scan cannot read: a label holding one names no row of the table. */
const UNREAD = '\u0000'
/** How deep a label is followed through constants, templates and callers. */
const MAX_DEPTH = 8

/** The engine's modules by their path under `src/`, tests and fixtures left out. */
const modules = new Map<string, string>()
for (const entry of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
  const file = entry.replaceAll('\\', '/')
  if (file.endsWith('.ts') && !/\.(test|fixture)\.ts$/.test(file))
    modules.set(file, readFileSync(new URL(file, source), 'utf8'))
}

/** The top-level arguments of the call or declaration whose `(` is at `open`, as spans. */
function argumentSpans(text: string, open: number) {
  const spans: Array<[number, number]> = []
  let depth = 0,
    from = open + 1
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if ('([{<'.includes(c) && !(c === '<' && text[i - 1] === '=')) depth++
    else if (')]}>'.includes(c) && text[i - 1] !== '=') {
      if (--depth === 0) {
        spans.push([from, i])
        return spans
      }
    } else if (c === ',' && depth === 1) {
      spans.push([from, i])
      from = i + 1
    }
  }
  return spans
}
const argumentsOf = (text: string, open: number) =>
  argumentSpans(text, open).map(([from, to]) => text.slice(from, to))

/** Index of the quote that closes the one at `open`, a template's `${…}` skipped whole. */
function closingQuote(text: string, open: number): number {
  const quote = text[open]
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (quote === '`' && c === '$' && text[i + 1] === '{') {
      for (let depth = 0, j = i + 1; j < text.length; j++) {
        const d = text[j]
        if (d === "'" || d === '"' || d === '`') j = closingQuote(text, j)
        else if (d === '{') depth++
        else if (d === '}' && --depth === 0) {
          i = j
          break
        }
      }
    } else if (c === quote) return i
  }
  return text.length
}

/** The expression that starts at `from`, past blanks: up to a comma, a semicolon or a bracket
 *  closing outside it, or the end of its line unless the next one carries it on. */
function expressionAt(text: string, from: number) {
  let i = from
  while (/\s/.test(text[i] ?? '')) i++
  const start = i
  for (let depth = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') i = closingQuote(text, i)
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth-- === 0) break
    } else if (depth === 0 && (c === ',' || c === ';')) break
    else if (
      depth === 0 &&
      c === '\n' &&
      !/^\s*[?:.+]/.test(text.slice(i + 1, i + 120)) &&
      !/[?:+=]\s*$/.test(text.slice(start, i))
    )
      break
  }
  return text.slice(start, i).trim()
}

/** Where the `{` of a labelled descriptor opens, the text at `from` opening with it; else -1. */
function opensAt(text: string, from: number) {
  const match = LABEL_FIRST.exec(text.slice(from))
  return match ? from + match[0].indexOf('{') : -1
}

/** The descriptors the argument `span` of the pass begun at `at` can be, as the offsets of their
 *  `{`, every one opening with its label; `null` when one does not. The argument opens with one,
 *  inline or made once (`list[i] ??= { label …`); or it is a name whose last assignment or
 *  property before the call opens with one, or a member whose every assignment does; or a
 *  helper's result, every descriptor the module types opening with one; or it is a parameter, and
 *  every call of its function passes a labelled one. */
function descriptorsOf(text: string, span: [number, number], at: number): number[] | null {
  const raw = text.slice(span[0], span[1]),
    start = span[0] + raw.length - raw.trimStart().length
  const expr = raw.trim().replace(/!$/, '')
  const inline = opensAt(text, start)
  if (inline >= 0) return [inline]
  const made = /^\(\s*[\w.]+(?:\[[^\]]*\])?\s*\?\?=/.exec(expr)
  if (made) {
    const open = opensAt(text, start + made[0].length)
    return open >= 0 ? [open] : null
  }
  const every = (matches: RegExpMatchArray[]) => {
    const opens = matches.map((m) => opensAt(text, m.index! + m[0].length))
    return opens.length > 0 && opens.every((open) => open >= 0) ? opens : null
  }
  // A descriptor a helper of the module hands back (`passes.surface(…)`): every pass descriptor
  // the module types opens with its label.
  if (/^[\w.]+\(/.test(expr))
    return every([...text.matchAll(/:\s*GPU(?:Render|Compute)PassDescriptor\s*=/g)])
  const name = expr.split('.').pop()!
  if (!name || !/^[\w.]+$/.test(expr)) return null
  const before = text.slice(0, at)
  const assigned = new RegExp(String.raw`\b${name}\b(?:\s*:[^=;{\n]*)?\s*=(?![=>])`, 'g')
  const last = [...before.matchAll(assigned)].at(-1)
  // A property of an object made once (`cull: { label … }`): written after the name's last
  // assignment, it is the nearer definition, the one a `holder.name` call reads, whatever another
  // function of the module binds to the same word.
  const property = [...before.matchAll(new RegExp(String.raw`\b${name}\s*:`, 'g'))].at(-1)
  if (property && property.index > (last?.index ?? -1)) {
    const open = opensAt(text, property.index + property[0].length)
    if (open >= 0) return [open]
  }
  if (last) {
    const open = opensAt(text, last.index + last[0].length)
    return open >= 0 ? [open] : null
  }
  // A holder's member a helper rebuilds before the call (`z.finalPass = { label …`): every such
  // assignment in the module opens with one.
  const rebuilt = [...text.matchAll(new RegExp(String.raw`\.${name}\s*=(?![=>])`, 'g'))]
  if (expr.includes('.') && rebuilt.length) return every(rebuilt)
  // A parameter: the function's callers hand it over.
  const parameter = [
    ...before.matchAll(
      new RegExp(String.raw`\b${name}: GPU(?:Compute|Render)PassDescriptor\b`, 'g'),
    ),
  ].at(-1)
  const declared =
    parameter && [...before.slice(0, parameter.index).matchAll(/function\*? (\w+)\(/g)].at(-1)
  if (!declared) return null
  const params = argumentsOf(text, declared.index + declared[0].length - 1)
  const index = params.findIndex((param) => new RegExp(String.raw`^\s*${name}\b`).test(param))
  const calls = [...text.matchAll(new RegExp(String.raw`(?<!function\*? )\b${declared[1]}\(`, 'g'))]
  if (index < 0 || !calls.length) return null
  const found: number[] = []
  for (const call of calls) {
    const spans = argumentSpans(text, call.index + call[0].length - 1)
    const inner = spans[index] ? descriptorsOf(text, spans[index], call.index) : null
    if (!inner) return null
    found.push(...inner)
  }
  return found
}

/** The module an import of `file` names, by its path under `src/`. */
const moduleOf = (file: string, specifier: string) =>
  new URL(specifier, new URL(file, source)).href.slice(source.href.length)

/** The callers' values of parameter `index` of the function or constructor declared at `at`. */
function callerValues(file: string, text: string, at: number, index: number, depth: number) {
  const declaration = text.slice(at)
  const fn = /^function\*?\s+(\w+)/.exec(declaration)?.[1]
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
  const declarations = [
    ...text.slice(0, at).matchAll(/(?:\bfunction\*?\s+\w+\s*|\bconstructor\s*)\(/g),
  ].reverse()
  for (const declaration of declarations) {
    const params = argumentsOf(text, declaration.index + declaration[0].length - 1)
    const index = params.findIndex((param) =>
      new RegExp(String.raw`^\s*(?:(?:private|public|protected|readonly)\s+)*${name}\b`).test(
        param,
      ),
    )
    if (index >= 0) return callerValues(file, text, declaration.index, index, depth)
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
function labelsOf(file: string, text: string, open: number) {
  const opening = /^\{\s*label\b\s*(:)?/.exec(text.slice(open))!
  return opening[1]
    ? valuesOf(file, text, expressionAt(text, open + opening[0].length), open)
    : valuesOf(file, text, 'label', open)
}

/** Whether the profile files a pass under `label`: a row of the table, or the virtual shadow
 *  maps' prefix, which a label read only in part must open with. */
const filed = (label: string) =>
  label.includes(UNREAD)
    ? label.split(UNREAD)[0].startsWith(VSM_PASS_PREFIX)
    : gpuPassStageOf(label) !== undefined

/** Every pass the engine begins: where, and the descriptors it can be (`null` unlabelled). */
const begun = [...modules]
  .filter(([file]) => file !== FORWARDER)
  .flatMap(([file, text]) =>
    [...text.matchAll(/\.begin(?:Render|Compute)Pass\(/g)].map((match) => {
      const span = argumentSpans(text, match.index + match[0].length - 1)[0]
      return {
        file,
        text,
        at: `${file}:${text.slice(0, match.index).split('\n').length}`,
        descriptors: span ? descriptorsOf(text, span, match.index) : null,
      }
    }),
  )

test('every render and compute pass the engine begins opens its descriptor with a label', () => {
  const missing = begun.filter((pass) => !pass.descriptors).map((pass) => pass.at)
  assert.ok(begun.length >= 40, `the scan reached the engine's passes (${begun.length})`)
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`')
})

test('every label a pass begins with is a row of the pass table', () => {
  const unnamed: string[] = []
  let read = 0
  for (const { file, text, at, descriptors } of begun)
    for (const open of descriptors ?? [])
      for (const label of labelsOf(file, text, open)) {
        read++
        if (!filed(label)) unnamed.push(`${at} ${label.replaceAll(UNREAD, '…')}`)
      }
  assert.ok(read >= begun.length, `every pass's label was read (${read})`)
  assert.deepEqual(unnamed, [], 'a pass the table does not name is filed under no stage')
})
