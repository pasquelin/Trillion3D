// The diff kernel of the instances' boxes, run in JavaScript on the shipped text, and two boxes the tests move placements between.
import { CAST_DIFF_WGSL } from './castDiffWgsl.ts'
import { CAST_HEADER_WORDS, CAST_RECORD_WORDS, CAST_STATE_WORDS } from './castChanges.ts'
import { ROOT_BOX_DOUBLES } from '../../../placement/roots/rootWorldSends.ts'
import { ROOT_SECTION, ROOT_SECTIONS } from './rootWordsWgsl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'

/** A double as the GPU holds it: its high word, then its low. */
const double = (x: number) => {
  const words = new Uint32Array(new Float64Array([x]).buffer)
  return [words[1], words[0]]
}
const bits = new Float32Array(1),
  asBits = new Uint32Array(bits.buffer)
const floatOf = (word: number) => ((asBits[0] = word), bits[0])
const bitsOf = (x: number) => ((bits[0] = x), asBits[0])

/** The diff kernel over `ROOTS` placements, run in JavaScript on the shipped text: its boxes and
 *  words set by `place`, its memory kept from step to step, the records of each step returned. The
 *  box widening is left out (the interpreter rounds nothing to single precision, so a widened box
 *  would differ from its stored one by the last bits): the boxes are dyadic, exact. */
export function diffKernel(roots: number, records = 16) {
  const rootBoxes: number[][] = Array.from({ length: roots * ROOT_BOX_DOUBLES }, () => double(0))
  const rootWorlds: number[][] = Array.from({ length: roots * 16 }, () => double(0))
  // The words, the instances' state, the squares of the offsets' distances, the reach (`ROOT_SECTIONS`).
  const rootWords = new Array<number>(ROOT_SECTIONS * roots).fill(0)
  const castState = new Array<number>(roots * CAST_STATE_WORDS).fill(0)
  const castChanges = new Array<number>(CAST_HEADER_WORDS + records * CAST_RECORD_WORDS).fill(0)
  // The arrivals: a bit a placement, `diff.arrivals` saying whether any is set.
  const arrived = new Array<number>(Math.max(1, Math.ceil(roots / 32))).fill(0)
  const diff = { roots, quiet: 0, views: 1, arrivals: 0 }
  const text = CAST_DIFF_WGSL.replace(/const BOX_SLACK:f32=[^;]+;/, 'const BOX_SLACK:f32=0.0;')
  const run = shaderRun<{
    castDiff: (id: number[], n: number[]) => void
    castInstanceState: (id: number[], n: number[]) => void
  }>(text, ['castDiff', 'castInstanceState'], {
    ...wgslConstants(text),
    diff,
    rootBoxes,
    rootWorlds,
    rootWords,
    castState,
    castChanges,
    arrived,
    arrayLength: (pointer: { get: () => unknown[] }) => pointer.get().length,
    atomicAdd: (p: { get: () => number; set: (v: number) => void }, v: number) => {
      const was = p.get()
      p.set(was + v)
      return was
    },
    atomicStore: (p: { set: (v: number) => void }, v: number) => p.set(v),
  })
  return {
    /** The diff's memory, `CAST_STATE_WORDS` words a placement. */
    castState,
    /** Placement `r` at the box `[lo, hi]` (none for `null`) with `word`, its offset stopping at
     *  `disableSq`. */
    place(r: number, box: number[] | null, word = 0, disableSq = 0) {
      const at = r * ROOT_BOX_DOUBLES
      for (let k = 0; k < 6; k++) rootBoxes[at + k] = double(box ? box[k] : 0)
      // The oriented box of the same bounds, along the world's axes: the centre (doubles 7..9), the
      // half axes (nine singles from double 11).
      const centre = box ? [0, 1, 2].map((a) => (box[a]! + box[3 + a]!) / 2) : [0, 0, 0]
      for (let a = 0; a < 3; a++) rootBoxes[at + 7 + a] = double(centre[a]!)
      const half = box ? [0, 1, 2].map((a) => (box[3 + a]! - box[a]!) / 2) : [0, 0, 0]
      const singles = new Uint32Array(10)
      const view = new Float32Array(singles.buffer)
      for (let c = 0; c < 3; c++) view[3 * c + c] = half[c]!
      for (let k = 0; k < 5; k++) rootBoxes[at + 11 + k] = [singles[2 * k]!, singles[2 * k + 1]!]
      rootWords[r] = word
      rootWords[2 * roots + r] = bitsOf(disableSq)
    },
    /** The instances' state per view over every placement, `arrivals` the ranks that arrived since
     *  it last ran; returns the state words (`ROOT_SECTION.state`) it wrote for the rootWords. */
    state(arrivals: number[] = []) {
      arrived.fill(0)
      for (const rank of arrivals) arrived[rank >> 5]! |= 1 << (rank & 31)
      diff.arrivals = arrivals.length ? 1 : 0
      for (let r = 0; r < roots; r++) run.castInstanceState([r, 0, 0], [roots, 1, 1])
      return rootWords.slice(ROOT_SECTION.state * roots, (ROOT_SECTION.state + 1) * roots)
    },
    /** The offset facts word of each record in the list so far, those the instances' state appended
     *  among them. */
    listedFacts() {
      const at = (k: number) => CAST_HEADER_WORDS + k * CAST_RECORD_WORDS
      return Array.from({ length: castChanges[0]! }, (_, k) => castChanges[at(k) + 11])
    },
    /** One diff, over every placement: the records it appended, each its box and moving flag, and
     *  beside them the offset facts each carries (the word bits, the distance's square); the
     *  header's overflow flag. */
    step(quiet = false, arrivals: number[] = []) {
      castChanges.fill(0)
      diff.quiet = quiet ? 1 : 0
      arrived.fill(0)
      for (const rank of arrivals) arrived[rank >> 5]! |= 1 << (rank & 31)
      diff.arrivals = arrivals.length ? 1 : 0
      for (let r = 0; r < roots; r++) run.castDiff([r, 0, 0], [roots, 1, 1])
      const out = [],
        facts = []
      for (let k = 0; k < Math.min(castChanges[0], records); k++) {
        const at = CAST_HEADER_WORDS + k * CAST_RECORD_WORDS
        const f = (i: number) => floatOf(castChanges[at + i])
        // The half axes lie along the world's: x at word 4, y at 8, z at 12.
        const ex = f(4),
          ey = f(9),
          ez = f(14)
        out.push({
          box: [f(0) - ex, f(1) - ey, f(2) - ez, f(0) + ex, f(1) + ey, f(2) + ez],
          moving: f(3) < 0,
        })
        facts.push({ offset: castChanges[at + 11], disableSq: f(15) })
      }
      return { records: out, facts, overflow: castChanges[1] !== 0 }
    },
  }
}

export const A = [0, 0, 0, 2, 2, 2],
  B = [4, 0, 0, 6, 2, 2]
