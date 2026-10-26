// The shipped suns' projection's code (`projection/projectionWgsl.ts`) for the tests that read or run it, the
// constructors of its structures, and a hash of integers.
import { mixWord } from '../../../../../math/src/scalar/integers.ts'
import { GOLDEN_U32 } from '../../../../../math/src/constants.ts'
import { vsmSunsProjectionWgsl } from './projection/projectionWgsl.ts'
import { vsmLayout } from './layout.ts'
const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 })
export const CODE = vsmSunsProjectionWgsl(LAYOUT)

/** A 32-bit hash of integers, the engine's `mixWord` folded over them: the same for the same ones. */
export const hash = (...words: number[]) =>
  words.reduce((h, w) => mixWord((h ^ w) >>> 0), GOLDEN_U32)

/** Each structure `source` declares, as its constructor: the arguments in member order. */
export function constructors(source: string) {
  const out: Record<string, (...args: unknown[]) => object> = {}
  for (const [, name, body] of source.matchAll(/struct (\w+)\s*\{([^}]*)\}/g)) {
    const keys = [...body.replace(/\/\/[^\n]*/g, '').matchAll(/(\w+)\s*:\s*\w+/g)].map((m) => m[1])
    out[name] = (...args) => Object.fromEntries(keys.map((key, i) => [key, args[i]]))
  }
  return out
}
