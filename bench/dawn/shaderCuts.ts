// The named cut points of a shader, and the variant that stops at one. A shader that wants to be
// taken apart carries lines like
//     // @cut decode keep: if (pixel.sceneDepth < -1e30) { sink[0] = 1u; }
// inside its entry function, at the top level of its body (comments: they cost the engine nothing).
// The variant of cut `decode` runs everything above the line, the `keep` statement — a store the
// compiler cannot prove dead, so what lies above survives — then returns. `-> value` after the
// name returns that value from an entry that gives one. The repository is never changed: a variant
// is made in memory, when the engine creates the module.

/** One cut point: its name, its line (0-based), what keeps the work above it alive, and the value
 *  the entry returns there. */
export type Cut = { name: string; line: number; keep: string; value: string }

const CUT = /^\s*\/\/\s*@cut\s+([\w-]+)(?:\s*->\s*(.+?))?(?:\s+keep:\s*(.*))?\s*$/

/** The cut points of `code`, in the order they appear. */
export function cutsOf(code: string): Cut[] {
  return code.split('\n').flatMap((text, line) => {
    const found = CUT.exec(text)
    return found
      ? [{ name: found[1], line, keep: found[3] ?? '', value: found[2]?.trim() ?? '' }]
      : []
  })
}

/** `code` stopped at cut `name`: its keep statement, then a return, in a block of their own — what
 *  follows is unreachable. Throws on a name the shader does not hold. */
export function cutAt(code: string, name: string) {
  const cut = cutsOf(code).find((c) => c.name === name)
  if (!cut) throw new Error(`BENCH_DISSECT: no cut "${name}" in the shader`)
  const lines = code.split('\n')
  lines[cut.line] = `{ ${cut.keep}\n return${cut.value ? ` ${cut.value}` : ''}; }`
  return lines.join('\n')
}

/** A short stable hash of a shader's text: the same code, the same name, in any process. */
export function hashOf(code: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
