// The run-time proxy's buffer as the tests lay it (`runtimeLayout.ts`): the arena — the blended copies'
// worlds, the surfaces, then a cut's columns — and the header's fields before it. The one writer of that
// layout the tests share: the run-time scene (`runtimeScene.fixture.ts`) and the reflection rig's faces.
import {
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_WORLD_WORDS,
  SURFACE_WORDS,
} from './runtimeLayout.ts'
import type { ArenaColumns } from './runtimeOracle.fixture.ts'

/** The header's fields, by name (`RUNTIME_HEADER`). */
export type ProxyHeader = Record<keyof typeof RUNTIME_HEADER, number>

/** The words of `values`, a float array, as they lie. */
const wordsOf = (values: Float32Array) =>
  new Uint32Array(values.buffer, values.byteOffset, values.length)

/** The arena over `columns`, after the copies' worlds (`copyWorlds`, sixteen floats each) and the
 *  surfaces (seven floats — tint, opacity, emission —, then a flags word each), and the word each
 *  region starts at, by the header's names. */
export function proxyArena(
  columns: ArenaColumns,
  surfaces: readonly (readonly number[])[],
  copyWorlds = new Float32Array(0),
) {
  const copyWorldsWord = 0,
    surfacesWord = copyWorldsWord + copyWorlds.length,
    trianglesWord = surfacesWord + surfaces.length * SURFACE_WORDS,
    boundsWord = trianglesWord + columns.triangles.length,
    childrenWord = boundsWord + columns.nodeBounds.length
  const words = new Uint32Array(childrenWord + columns.nodeChildren.length)
  words.set(wordsOf(copyWorlds), copyWorldsWord)
  surfaces.forEach((surface, k) => {
    const at = surfacesWord + k * SURFACE_WORDS
    new Float32Array(words.buffer, at * 4, 7).set(surface.slice(0, 7))
    words[at + 7] = surface[7]
  })
  words.set(wordsOf(columns.triangles), trianglesWord)
  words.set(wordsOf(columns.nodeBounds), boundsWord)
  words.set(columns.nodeChildren, childrenWord)
  return {
    words,
    regions: { copyWorldsWord, surfacesWord, trianglesWord, boundsWord, childrenWord },
    copies: copyWorlds.length / RUNTIME_WORLD_WORDS,
  }
}

/** The proxy's buffer: the header's fields at their words, `error` as an `f32`'s bits, then `arena`,
 *  and one word past it. */
export function proxyBuffer(header: ProxyHeader, arena: Uint32Array) {
  const words = new Uint32Array(RUNTIME_HEADER_WORDS + arena.length + 1)
  for (const [name, at] of Object.entries(RUNTIME_HEADER)) {
    const value = header[name as keyof ProxyHeader]
    words[at] = name === 'error' ? new Uint32Array(Float32Array.of(value).buffer)[0] : value
  }
  words.set(arena, RUNTIME_HEADER_WORDS)
  return words
}
