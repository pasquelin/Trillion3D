// The engine's source as the pass-label test reads it (`passLabels.test.ts`): its modules, and
// for a pass it begins, the descriptors its argument can be.
import { readdirSync, readFileSync } from 'node:fs'

const source = new URL('../../', import.meta.url)
/** A descriptor opens with its label: `{ label: …, … }`, whatever the spacing. */
const LABEL_FIRST = new RegExp(String.raw`^\s*\{\s*label\b`)

/** The engine's modules by their path under `src/`, tests and fixtures left out. */
export const modules = new Map<string, string>()
for (const entry of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
  const file = entry.replaceAll('\\', '/')
  if (file.endsWith('.ts') && !/\.(test|fixture)\.ts$/.test(file))
    modules.set(file, readFileSync(new URL(file, source), 'utf8'))
}

/** The top-level arguments of the call or declaration whose `(` is at `open`, as spans. */
export function argumentSpans(text: string, open: number) {
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
export const argumentsOf = (text: string, open: number) =>
  argumentSpans(text, open).map(([from, to]) => text.slice(from, to))

/** Index of the quote that closes the one at `open`, a template's `${…}` skipped whole. */
export function closingQuote(text: string, open: number): number {
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
export function expressionAt(text: string, from: number) {
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
export function descriptorsOf(text: string, span: [number, number], at: number): number[] | null {
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
export const moduleOf = (file: string, specifier: string) =>
  new URL(specifier, new URL(file, source)).href.slice(source.href.length)
