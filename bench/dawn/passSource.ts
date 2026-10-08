// A pass's label read back to the code: the file and function that encode it, and the shaders that
// file imports. The engine names each pass by a string; this finds where the string lives, and —
// when it is a constant — the file that uses the constant to begin the pass. Paths are the
// checkout's own, relative to its root, never the machine's.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Where a pass is encoded: the checkout's file and line, its function, and its shader modules. */
export type PassSource = { file: string; line: number; fn: string | null; shaders: string[] }

/** The folders of the engine whose sources name passes. */
const FOLDERS = ['packages/sdk-browser/src', 'packages/sdk-core/src']
const SKIP = /\.(test|fixture)\.ts$|\.d\.ts$/
const BEGINS = /begin(Render|Compute)Pass/

/** Every engine source of `root`, as `[path relative to root, text]`. */
export function engineSources(root: string) {
  const files: [string, string][] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts') && !SKIP.test(entry.name))
        files.push([relative(root, path), readFileSync(path, 'utf8')])
    }
  }
  for (const folder of FOLDERS) walk(join(root, folder))
  return files
}

/** A pass label without the batch number and the engine's prefix: the string its code holds. */
export const labelStem = (name: string) =>
  name
    .replace(/ \*$/, '')
    .replace(/ \d+$/, '')
    .replace(/^Trillion3D /, '')

/** The function a line lies in: the nearest declaration above it, or null. */
function functionAt(lines: readonly string[], at: number) {
  for (let i = at; i >= 0; i--) {
    const found =
      /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/.exec(lines[i]) ??
      /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/.exec(lines[i]) ??
      /^\s{2,4}(?:async\s+|static\s+|private\s+)*(\w+)\s*\([^)]*\)\s*(?::[^{]*)?\{\s*$/.exec(
        lines[i],
      )
    if (found && !['if', 'for', 'while', 'switch', 'catch'].includes(found[1])) return found[1]
  }
  return null
}

/** The shader modules a source imports: its imports whose name or path says WGSL or shader. */
function shadersOf(text: string) {
  return [...text.matchAll(/import\s[^'"]*?from\s+['"]([^'"]+)['"]/g)]
    .map((found) => found[1])
    .filter((path) => /wgsl|shader/i.test(path))
}

/** The source of each pass name of `names`, found in `sources`; a name nothing holds is absent. */
export function findPassSources(sources: readonly [string, string][], names: readonly string[]) {
  const found = new Map<string, PassSource>()
  for (const name of names) {
    const stem = labelStem(name)
    const literal = new RegExp(
      `['"\`](?:Trillion3D )?${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"\`]| \\d|\\s?\\$\\{)`,
    )
    let best: PassSource | null = null
    for (const [file, text] of sources) {
      const lines = text.split('\n')
      const at = lines.findIndex((line) => literal.test(line))
      if (at < 0) continue
      // A constant (`const TAA_PASS = '…'`): the encoder is a file that begins a pass with it.
      const constant = /(?:const|let)\s+(\w+)\s*=/.exec(lines[at])?.[1]
      const users = constant
        ? sources.filter(([, other]) => other.includes(constant) && BEGINS.test(other))
        : []
      const [userFile, userText] = users[0] ?? [file, text]
      const userLines = userText.split('\n')
      const line = users[0]
        ? userLines.findIndex(
            (l) => l.includes(constant!) && !/^\s*import\b|(?:const|let)\s+\w+\s*=\s*['"`]/.test(l),
          )
        : at
      const here: PassSource = {
        file: userFile,
        line: Math.max(0, line) + 1,
        fn: functionAt(userLines, Math.max(0, line)),
        shaders: shadersOf(userText),
      }
      // The one that begins a pass is the encoder; a mere mention is kept only as a fallback.
      if (
        BEGINS.test(userText) &&
        (!best || !BEGINS.test(sources.find(([f]) => f === best!.file)?.[1] ?? ''))
      )
        best = here
      else best ??= here
      if (BEGINS.test(userText)) break
    }
    if (best) found.set(name, best)
  }
  return found
}
