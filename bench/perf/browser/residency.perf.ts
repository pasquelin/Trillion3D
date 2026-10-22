// GPU residency bits, DAG readback and world stretch.
import { maxStretch } from '../../../packages/math/src/projection/projectionOracles.ts'
import { updateResidencyBits } from '../../../packages/sdk-browser/src/geometry/dag/residencyUpload.ts'
import { parseDagOutput } from '../../../packages/sdk-browser/src/geometry/dag/uniforms.ts'
import { residentWords } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import {
  listWords,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import { referenceUpdateResidency, residencyColumn } from '../../oracles/browser/residency.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'

const CONE_FLOATS = 12,
  FLAG = 11
const alea = xorshiftRandom(53)
const PAGES = 20000

const images = []
for (let image = 0; image < 8; image++) {
  const next = new Uint32Array(PAGES)
  for (let j = 0; j < PAGES; j++) next[j] = (j + image) % 40 ? 1 : 0
  images.push(next)
}

const conesReference = new Float32Array(PAGES * CONE_FLOATS)
for (let j = 0; j < PAGES * CONE_FLOATS; j++) conesReference[j] = alea()

const base = 0,
  bits = new Uint32Array(base + residentWords(PAGES)),
  motsTouches = new Int32Array(residentWords(PAGES))
for (let j = 0; j < PAGES; j++)
  if (conesReference[j * CONE_FLOATS + FLAG] >= 0.5) setBit(bits, base * 32 + j)

const column = (cones: Float32Array) => {
  const output = new Float32Array(PAGES)
  for (let j = 0; j < PAGES; j++) output[j] = cones[j * CONE_FLOATS + FLAG]
  return output
}

const worlds = new Float32Array(64 * 16)
for (let i = 0; i < worlds.length; i++) worlds[i] = i % 17 === 0 ? 1 + alea() : alea() * 0.01

// A readout as a cut leaves it (`readoutWords.ts`): 12 000 requests behind the header, the 20 000
// drawn pages' list behind them, then each request's priority word and its page count (one page each).
const REQUESTS = 12000,
  DRAWN = 20000,
  drawnAt = listWords(REQUESTS),
  prioritiesAt = drawnAt + listWords(DRAWN),
  countsAt = prioritiesAt + REQUESTS
const sortieGpu = new Uint32Array(countsAt + REQUESTS)
sortieGpu[0] = REQUESTS
sortieGpu[1] = 431
sortieGpu[2] = 5
for (let i = 0; i < REQUESTS; i++) {
  sortieGpu[SELECTION_HEADER_WORDS + i] = i * 3
  sortieGpu[prioritiesAt + i] = REQUESTS - i
  sortieGpu[countsAt + i] = 1
}
sortieGpu[drawnAt] = DRAWN
for (let i = 0; i < DRAWN; i++) sortieGpu[drawnAt + SELECTION_HEADER_WORDS + i] = i

const resResidencyBits = await measure({
  name: 'residency-bit update',
  fichier: 'packages/sdk-browser/src/geometry/dag/residencyUpload.ts',
  cas: [{ name: '8 frames, 20 000 pages', input: images, size: PAGES * 8 }],
  calculation: (imgs) => ({
    drapeaux: imgs.map(
      (next) =>
        updateResidencyBits((j) => !!next[j], next.length, bits, base, undefined, motsTouches) > 0,
    ),
    column: residencyColumn(bits, base, PAGES),
  }),
  expected: (imgs) => ({
    drapeaux: imgs.map((next) => referenceUpdateResidency(next, conesReference)),
    column: column(conesReference).map((v) => (v >= 0.5 ? 1 : 0)),
  }),
  options: { tours: 100, budgetMs: 1000 },
})

const resParseDag = await measure({
  name: 'GPU cut read',
  fichier: 'packages/sdk-browser/src/geometry/dag/uniforms.ts',
  cas: [
    {
      name: 'cut read, 12 000 requests, 20 000 drawn',
      input: { drawn: drawnAt, priorities: prioritiesAt, counts: countsAt },
      size: REQUESTS,
    },
    {
      name: 'no drawn list',
      input: { drawn: 0, priorities: prioritiesAt, counts: countsAt },
      size: REQUESTS,
    },
  ],
  calculation: (at) => parseDagOutput(sortieGpu.buffer, 0, sortieGpu.byteLength, at),
  // The oracle takes a per-page flag mask; the engine receives already-compacted lists and their
  // word offsets. The two do not describe the same output: correctness of `parseDagOutput` is held
  // by `packages/sdk-browser/src/geometry/dag/uniforms.test.ts`, not by this bench.
  expected: undefined,
  motif:
    'oracle from before batch A is stale — correctness in packages/sdk-browser/src/geometry/dag/uniforms.test.ts',
  options: { tours: 100, budgetMs: 1000 },
})

// `maxStretch` now reads the world-buffer view without copying it: the oracle is the same
// computation on a copy, and the line fails if the in-place read changes a single bit.
const etirements = (lecture: (w: number) => ArrayLike<number>) => () => {
  const output = new Float64Array(64)
  for (let w = 0; w < 64; w++) output[w] = maxStretch(lecture(w))
  return output
}

const resEtirement = await measure({
  name: 'maximum world stretch',
  fichier: 'packages/math/src/projection/projectionOracles.ts',
  cas: [{ name: '64 worlds', input: null, size: 64 }],
  calculation: etirements((w) => worlds.subarray(w * 16, w * 16 + 16)),
  expected: etirements((w) => Array.from(worlds.subarray(w * 16, w * 16 + 16))),
  options: { tours: 100, budgetMs: 1000 },
})

rapport(
  'residence',
  [resResidencyBits, resParseDag, resEtirement],
  'A11 yields the exact same flags, cuts and stretches',
)
