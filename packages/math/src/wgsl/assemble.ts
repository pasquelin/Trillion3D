import { commentEnd } from './comments.ts'
import type { WgslDecl } from './decl.ts'

/** A declaration's key: its WGSL name; a fragment's apart, as its name is no identifier. */
const keyOf = (decl: WgslDecl) => (decl.kind === 'block' ? `block ${decl.name}` : decl.name)

/** One step of the path by which a declaration was reached: the dependents above it. */
type Step = { readonly decl: WgslDecl; readonly parent: Step | null }

/** The names from the first dependent down to `step`, joined; only an error pays for it. */
const pathOf = (step: Step | null) => {
  const names: string[] = []
  for (let at = step; at; at = at.parent) names.push(at.decl.name)
  return names.reverse().join(' > ')
}

/** The first line at which two texts differ, each shown, so a conflict is readable. */
const firstDifference = (a: string, b: string) => {
  const left = a.split('\n')
  const right = b.split('\n')
  let i = 0
  while (i < left.length && i < right.length && left[i] === right[i]) i++
  const show = (line: string | undefined) =>
    line === undefined ? '(end)' : line.trim().slice(0, 80)
  return `line ${i + 1}: '${show(left[i])}' against '${show(right[i])}'`
}

/**
 * The declarations `decls` need, in the order a module writes them: depth first, each one's
 * dependencies before it, each name once. A name met again with the same text is the same
 * declaration and is skipped, its dependencies still visited: a fragment that lists another
 * provider of a function (`mipRead`, `mirrorRadiance`) brings it. A name is looked up once the
 * declaration's dependencies are written, as they may declare it themselves. A name met with
 * another text is refused, naming the path by which each declaration came and the first line where
 * the texts differ, so a fragment parameterised by a provider needs no naming of its own; a
 * dependency cycle is refused too, both when the pipeline is described and never in a frame. One
 * visit per declaration and per edge; a path is joined only to be thrown.
 */
function ordered(decls: readonly WgslDecl[]) {
  const written = new Map<string, Step>()
  const visited = new Set<WgslDecl>()
  const open = new Set<WgslDecl>()
  const out: WgslDecl[] = []
  const visit = (decl: WgslDecl, parent: Step | null) => {
    if (visited.has(decl)) return
    if (open.has(decl)) throw new Error(`WGSL '${decl.name}' depends on itself`)
    const step: Step = { decl, parent }
    open.add(decl)
    for (const dep of decl.deps) visit(dep, step)
    open.delete(decl)
    visited.add(decl)
    const key = keyOf(decl)
    const seen = written.get(key)
    if (seen && seen.decl.text !== decl.text)
      throw new Error(
        `WGSL '${decl.name}' declared twice: ${pathOf(seen)} and ${pathOf(step)} (${firstDifference(seen.decl.text, decl.text)})`,
      )
    if (!seen) {
      written.set(key, step)
      out.push(decl)
    }
  }
  for (const decl of decls) visit(decl, null)
  return out
}

/** A directive (`enable`, `requires`, `diagnostic`), which WGSL puts before every declaration. */
const DIRECTIVE = /(?:enable|requires|diagnostic)\b[^;]*;/y
/** Directives opening a text, with the blanks before and between them. */
const LEADING = /^(?:\s*(?:enable|requires|diagnostic)\b[^;]*;)+/
/**
 * `text`'s module-scope directives and `text` without them: a statement opening with one of the
 * three words — the first of the text, or after `;` or `}` — outside comments, parentheses and
 * braces. Never an attribute (`@diagnostic`, `@ diagnostic`), a parameter, a member, nor a word of
 * a comment or a body.
 */
function directivesOf(text: string) {
  const found: string[] = []
  if (!/\b(?:enable|requires|diagnostic)\b/.test(text)) return { found, rest: text }
  let rest = ''
  let from = 0
  let depth = 0
  /** The last character neither blank nor in a comment; the text's start reads as a `;`. */
  let last = ';'
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = commentEnd(text, i)
      continue
    }
    if (depth === 0 && (last === ';' || last === '}') && 'erd'.includes(c)) {
      DIRECTIVE.lastIndex = i
      const match = DIRECTIVE.exec(text)
      if (match) {
        found.push(match[0])
        rest += text.slice(from, i)
        i = from = i + match[0].length
        continue
      }
    }
    if (c === '{' || c === '(') depth++
    else if (c === '}' || c === ')') depth--
    if (!/\s/.test(c)) last = c
    i++
  }
  return { found, rest: rest + text.slice(from) }
}

/** Each declaration's directives and text without them, read once: declarations are frozen. */
const ownDirectives = new WeakMap<WgslDecl, ReturnType<typeof directivesOf>>()

/** A declaration's directives and text without them. */
function directivesOfDecl(decl: WgslDecl) {
  let own = ownDirectives.get(decl)
  if (!own) ownDirectives.set(decl, (own = directivesOf(decl.text)))
  return own
}

/** A directive with its blanks collapsed, as two spellings of one name it. */
const normalized = (directive: string) => directive.replace(/\s+/g, ' ')

/** The directives of `found` not in `known` (those written before them), each once, one a line,
 *  after `lead` when it holds any. */
const moreDirectives = (lead: string, known: Set<string>, found: readonly string[]) => {
  const more: string[] = []
  for (const directive of found) {
    const key = normalized(directive)
    if (known.has(key)) continue
    known.add(key)
    more.push(directive)
  }
  return more.length ? `${lead ? '\n' : ''}${more.join('\n')}` : ''
}

/** `decls` in order, each declaration's directives taken out of its text, and those directives. */
function assembled(decls: readonly WgslDecl[]) {
  const found: string[] = []
  const texts = ordered(decls).map((decl) => {
    const own = directivesOfDecl(decl)
    found.push(...own.found)
    return own.rest
  })
  return { found, text: texts.join('\n') }
}

/** `directives`, then `text` from a line of its own: a line break between them when `text` opens
 *  with none. */
const afterDirectives = (directives: string, text: string) =>
  directives && text && text[0] !== '\n' ? `${directives}\n${text}` : directives + text

/** The WGSL text declaring `decls` and everything they depend on, dependencies first; the
 *  directives its fragments hold written once, before them. */
export const wgslModule = (...decls: readonly WgslDecl[]) => {
  const { found, text } = assembled(decls)
  return afterDirectives(moreDirectives('', new Set(), found), text)
}

/** A program's whole text: its directives — its own, wherever its text holds them, and its
 *  fragments' — each once, then the declarations and fragments it `uses`, then its own text. Only a
 *  whole program calls it; a fragment is a `wgslBlock` its hosts list. */
export const wgslProgram = (own: string, uses: readonly WgslDecl[]) => {
  const lead = LEADING.exec(own)?.[0] ?? ''
  const after = directivesOf(own.slice(lead.length))
  if (!uses.length && !after.found.length) return own
  const known = new Set(directivesOf(lead).found.map(normalized))
  const { found, text } = assembled(uses)
  const directives = lead + moreDirectives(lead, known, [...after.found, ...found])
  return `${afterDirectives(directives, text)}\n${after.rest}`
}
