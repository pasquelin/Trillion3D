// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and a ranking cannot attribute a span named `beginRenderPass`. Every pass the
// engine begins is read here from the source: its descriptor, inline or declared before the call
// in the same module, opens with its label. A new pass without one fails this test, never the
// ranking.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const source = new URL('../../', import.meta.url)
/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts'
/** A descriptor opens with its label: `{ label: …, … }`, whatever the spacing. */
const LABEL_FIRST = String.raw`\s*\{\s*label\b`
/** The top-level arguments of the call or declaration whose `(` is at `open`. */
function argumentsOf(text: string, open: number) {
  const args: string[] = []
  let depth = 0,
    from = open + 1
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if ('([{<'.includes(c) && !(c === '<' && text[i - 1] === '=')) depth++
    else if (')]}>'.includes(c) && text[i - 1] !== '=') {
      if (--depth === 0) return [...args, text.slice(from, i)]
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(from, i))
      from = i + 1
    }
  }
  return args
}

/** Whether the descriptor expression `argument` of the pass begun at `at` has a label: it opens
 *  with one, inline or made once (`list[i] ??= { label …`); or it is a name whose last assignment
 *  or property before the call opens with one, or a member whose every assignment does; or a
 *  helper's result, every descriptor the module types opening with one; or it is a parameter, and
 *  every call of its function passes a labelled one. */
function labelled(file: string, text: string, argument: string, at: number): boolean {
  const expr = argument.trim().replace(/!$/, '')
  if (new RegExp(`^${LABEL_FIRST}`).test(expr)) return true
  if (/^\(\s*[\w.]+(?:\[[^\]]*\])?\s*\?\?=\s*\{\s*label\b/.test(expr)) return true
  const opens = (from: number) => new RegExp(`^${LABEL_FIRST}`).test(text.slice(from))
  // A descriptor a helper of the module hands back (`passes.surface(…)`): every pass descriptor
  // the module types opens with its label.
  if (/^[\w.]+\(/.test(expr)) {
    const typed = [...text.matchAll(/:\s*GPU(?:Render|Compute)PassDescriptor\s*=/g)]
    return typed.length > 0 && typed.every((m) => opens(m.index + m[0].length))
  }
  const name = expr.split('.').pop()!
  if (!name || !/^[\w.]+$/.test(expr)) return false
  const before = text.slice(0, at)
  const assigned = new RegExp(String.raw`\b${name}\b(?:\s*:[^=;{\n]*)?\s*=(?![=>])`, 'g')
  const last = [...before.matchAll(assigned)].at(-1)
  // A property of an object made once (`cull: { label … }`): written after the name's last
  // assignment, it is the nearer definition, the one a `holder.name` call reads, whatever another
  // function of the module binds to the same word.
  const property = [...before.matchAll(new RegExp(String.raw`\b${name}\s*:`, 'g'))].at(-1)
  if (
    property &&
    property.index > (last?.index ?? -1) &&
    opens(property.index + property[0].length)
  )
    return true
  if (last) return opens(last.index + last[0].length)
  // A holder's member a helper rebuilds before the call (`z.finalPass = { label …`): every such
  // assignment in the module opens with one.
  const rebuilt = [...text.matchAll(new RegExp(String.raw`\.${name}\s*=(?![=>])`, 'g'))]
  if (expr.includes('.') && rebuilt.length)
    return rebuilt.every((m) => opens(m.index + m[0].length))
  // A parameter: the function's callers hand it over.
  const parameter = [
    ...before.matchAll(
      new RegExp(String.raw`\b${name}: GPU(?:Compute|Render)PassDescriptor\b`, 'g'),
    ),
  ].at(-1)
  const declared =
    parameter && [...before.slice(0, parameter.index).matchAll(/function\*? (\w+)\(/g)].at(-1)
  if (!declared) return false
  const params = argumentsOf(text, declared.index + declared[0].length - 1)
  const index = params.findIndex((param) => new RegExp(String.raw`^\s*${name}\b`).test(param))
  const calls = [...text.matchAll(new RegExp(String.raw`(?<!function\*? )\b${declared[1]}\(`, 'g'))]
  return (
    index >= 0 &&
    calls.length > 0 &&
    calls.every((call) =>
      labelled(
        file,
        text,
        argumentsOf(text, call.index + call[0].length - 1)[index] ?? '',
        call.index,
      ),
    )
  )
}

test('every render and compute pass the engine begins opens its descriptor with a label', () => {
  const found: string[] = [],
    missing: string[] = []
  const call = /\.begin(?:Render|Compute)Pass\(/g
  for (const entry of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    const file = entry.replaceAll('\\', '/')
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file) || file === FORWARDER) continue
    const text = readFileSync(new URL(file, source), 'utf8')
    for (const match of text.matchAll(call)) {
      const at = `${file}:${text.slice(0, match.index).split('\n').length}`
      found.push(at)
      const descriptor = argumentsOf(text, match.index + match[0].length - 1)[0]
      if (!labelled(file, text, descriptor, match.index)) missing.push(at)
    }
  }
  assert.ok(found.length >= 40, `the scan reached the engine's passes (${found.length})`)
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`')
})
