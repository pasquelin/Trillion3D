// The Rust constants the rule printer reads (`../generate-shared-rules.ts`): the `pub const` items of
// a Rust module, each with its leading documentation, the value computed from its literals and the
// constants it names. Rust owns these numbers; the other languages print them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPOSITORY_ROOT } from '../repository-files.ts'

/** The text of the Rust file at `path`, the one place the rules read Rust source from. */
export const rustSource = (path: string) => readFileSync(join(REPOSITORY_ROOT, path), 'utf8')

/** A `pub const` of a Rust module: its name, its value and its leading documentation. */
export type RustConstant = { name: string; value: number; doc: string[]; scope: string[] }

/** The value of the integer expression `text`, its names read from `known`. */
function evaluate(text: string, known: ReadonlyMap<string, number>): number {
  const source = text.replace(/\s+as\s+\w+/g, '').replace(/(?<=\d)_(?=\d)/g, '')
  const tokens = source.match(/0x[0-9a-fA-F]+|\d+|[A-Za-z_]\w*|<<|[-+*()]/g) ?? []
  let at = 0
  const sum = (): number => {
    let value = product()
    while (tokens[at] === '+' || tokens[at] === '-')
      value = tokens[at++] === '+' ? value + product() : value - product()
    return value
  }
  const product = (): number => {
    let value = shift()
    while (tokens[at] === '*') {
      at++
      value *= shift()
    }
    return value
  }
  const shift = (): number => {
    let value = atom()
    while (tokens[at] === '<<') {
      at++
      value *= 2 ** atom()
    }
    return value
  }
  const atom = (): number => {
    const token = tokens[at++]
    if (token === '(') {
      const value = sum()
      at++
      return value
    }
    if (token === '-') return -atom()
    if (/^(0x)?\d/.test(token)) return Number(token)
    const named = known.get(token)
    if (named === undefined) throw new Error(`Rust constant '${text}' names unknown '${token}'`)
    return named
  }
  const value = sum()
  if (at !== tokens.length) throw new Error(`Rust constant '${text}' is not an integer expression`)
  return value
}

/** The `pub const` integers of the Rust file at `path`, in order; those of a `pub mod` carry its
 *  name in `scope`. Only single-line items are read. */
export function rustConstants(path: string, known = new Map<string, number>()) {
  const found: RustConstant[] = []
  const scope: string[] = []
  let doc: string[] = []
  for (const line of rustSource(path).split('\n')) {
    const text = line.trim()
    const comment = /^\/\/\/ ?(.*)$/.exec(text)
    if (comment) {
      doc.push(comment[1])
      continue
    }
    const module = /^pub mod (\w+) \{$/.exec(text)
    const numeric = /^pub const (\w+): (?:[iu](?:8|16|32|64)|usize) = (.+);$/.exec(text)
    if (module) scope.push(module[1])
    else if (text === '}' && scope.length) scope.pop()
    else if (numeric) {
      const value = evaluate(numeric[2], known)
      known.set(numeric[1], value)
      found.push({ name: numeric[1], value, doc, scope: [...scope] })
    }
    doc = []
  }
  return found
}
