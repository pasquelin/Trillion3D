/**
 * THE LIST THE LIGHT COMPLEXITY REPLAY LEAVES (`replayWgsl.ts`), one buffer of words the host reads back: a header, then the lights of the cell under the cursor sorted by the weight the sampling gave
 * them, the heaviest first. A light is eight words: its rank, whether it was seen in the image before and its kind packed in the first (`rank | seen << 16 | kind << 24`), its weight, its place (a sun's
 * direction toward it) and its colour. The same numbers feed the shader and the host, so the layout is written once, here.
 */

/** The most lights the replay lists: twice the threads of its sort. */
export const COMPLEXITY_MAX_LIGHTS = 512
/** The words of the header and of one light. */
export const COMPLEXITY_HEADER_WORDS = 8
export const COMPLEXITY_ENTRY_WORDS = 8
/** The words of the result, and its bytes. */
export const COMPLEXITY_RESULT_WORDS =
  COMPLEXITY_HEADER_WORDS + COMPLEXITY_MAX_LIGHTS * COMPLEXITY_ENTRY_WORDS
export const COMPLEXITY_RESULT_BYTES = COMPLEXITY_RESULT_WORDS * 4

/** Where the header holds each thing: the lights listed, the sum of their weights, the point the lights are looked at from (three words) whether a point was found (1) and, last, a mark (1) the replay sets whenever it ran, so that a result it never wrote is not read; one word is unused. */
export const COMPLEXITY_HEADER = { count: 0, sum: 1, position: 2, valid: 5, written: 7 } as const

/** The kinds a light is listed as. */
export const COMPLEXITY_KIND = { directional: 0, point: 1, spot: 2, rect: 3 } as const
export const COMPLEXITY_KIND_NAMES = ['Dir', 'Point', 'Spot', 'Rect'] as const

/** One light of the list. */
export interface ComplexityLight {
  rank: number
  /** Whether the light was seen from the pixel in the image before (1) or not (0). */
  seen: number
  kind: number
  weight: number
  /** The light's place, or for a directional light the direction toward it. */
  place: readonly [number, number, number]
  color: readonly [number, number, number]
}

/** What the replay found: the point it looked from, the sum of the weights and the lights, sorted. */
export interface ComplexityList {
  /** Whether the replay wrote this result (else it is the buffer as it was made). */
  written: boolean
  valid: boolean
  position: readonly [number, number, number]
  sum: number
  lights: readonly ComplexityLight[]
}

/** The list a result of `words` (`COMPLEXITY_RESULT_WORDS`, as the replay left them) holds; the lights past the count are not read. */
export function decodeComplexity(words: Uint32Array): ComplexityList {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
  const count = Math.min(words[COMPLEXITY_HEADER.count]!, COMPLEXITY_MAX_LIGHTS)
  const triple = (at: number) => [floats[at]!, floats[at + 1]!, floats[at + 2]!] as const
  const lights: ComplexityLight[] = []
  for (let index = 0; index < count; index++) {
    const at = COMPLEXITY_HEADER_WORDS + index * COMPLEXITY_ENTRY_WORDS
    const first = words[at]!
    lights.push({
      rank: first & 0xffff,
      seen: ((first >>> 16) & 0xff) / 255,
      kind: first >>> 24,
      weight: floats[at + 1]!,
      place: triple(at + 2),
      color: triple(at + 5),
    })
  }
  return {
    written: words[COMPLEXITY_HEADER.written] === 1,
    valid: words[COMPLEXITY_HEADER.valid] !== 0,
    position: triple(COMPLEXITY_HEADER.position),
    sum: floats[COMPLEXITY_HEADER.sum]!,
    lights,
  }
}
