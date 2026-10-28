import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  addLightSample,
  candidateIndex,
  candidateVisible,
  candidateWeight,
  estimateLocalLight,
  hashLightIndex,
  initLightSamplerStratified,
  isLightHidden,
  isLightVisible,
  lightSampleGuided,
  lightSampleIndex,
  lightSampleRayCompleted,
  lightSampleRayDistance,
  lightSampleRayType,
  lightSampleRayUv,
  lightSampleVisible,
  lightSampleWeight,
  lightTargetWeight,
  noLightRay,
  noLightSample,
  packLightSample,
  packLightSampleRay,
  unpackTile,
} from './lightSamplerWgsl.ts'

/** The samples a sampler holds: the packed candidates' count the shader declares. */
const SAMPLER_MAX_SAMPLES = 4

/** Every declaration of the light sampling a proof lists (the candidates' packing comes with the sampler's). */
export const LIGHT_SAMPLER_DECLS: readonly WgslDecl[] = [
  hashLightIndex,
  isLightVisible,
  isLightHidden,
  candidateIndex,
  candidateVisible,
  candidateWeight,
  initLightSamplerStratified,
  addLightSample,
  estimateLocalLight,
  lightTargetWeight,
  packLightSample,
  lightSampleIndex,
  lightSampleWeight,
  lightSampleVisible,
  lightSampleGuided,
  packLightSampleRay,
  lightSampleRayUv,
  lightSampleRayType,
  lightSampleRayCompleted,
  lightSampleRayDistance,
  unpackTile,
  noLightSample,
  noLightRay,
]

const mul = (a: number, b: number) => Math.imul(a, b) >>> 0
const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0

/** The reference of `hashLightIndex`. */
export function hashLightIndexRef(input: number) {
  let h = (input + 374761393) >>> 0
  h = mul(668265263, rotl(h, 17))
  h = mul(2246822519, (h ^ (h >>> 15)) >>> 0)
  h = mul(3266489917, (h ^ (h >>> 13)) >>> 0)
  return (h ^ (h >>> 16)) >>> 0
}

/** The two (word, bit) pairs the hash names in a set of `words` words, `wordBits` bits wide for the word index. */
const slots = (hash: number, wordBits: number) => {
  const mask = (1 << wordBits) - 1
  return [
    [hash & mask, (hash >>> (2 * wordBits)) & 31],
    [(hash >>> wordBits) & mask, (hash >>> (2 * wordBits + 5)) & 31],
  ] as const
}

/** Sets the light's two bits in `set` (four words for the visible set, two for the hidden). */
export function markLight(set: Uint32Array, lightIndex: number) {
  for (const [word, bit] of slots(hashLightIndexRef(lightIndex), set.length === 4 ? 2 : 1))
    set[word] = (set[word]! | (1 << bit)) >>> 0
}

/** Whether both of the light's bits are in `set`. */
export function holdsLight(set: Uint32Array, lightIndex: number) {
  return slots(hashLightIndexRef(lightIndex), set.length === 4 ? 2 : 1).every(
    ([word, bit]) => (set[word]! & (1 << bit)) !== 0,
  )
}

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
/** A half float's bits (truncating the mantissa as a conversion to a half does for the weights, which are positive). */
function toHalfBits(value: number) {
  f32[0] = value
  const x = u32[0]!
  const exp = ((x >>> 23) & 0xff) - 127 + 15
  if (exp <= 0) return 0
  if (exp >= 31) return 0x7c00
  return (exp << 10) | ((x >>> 13) & 0x3ff)
}
function fromHalfBits(bits: number) {
  const exp = (bits >>> 10) & 31
  const man = bits & 0x3ff
  return exp === 0 ? man * 2 ** -24 : (1 + man / 1024) * 2 ** (exp - 15)
}

export interface Candidate {
  index: number
  visible: boolean
  weight: number
}
/** The reference of `packCandidate`. */
export const packCandidateRef = (c: Candidate) =>
  ((c.index & 0x7fff) | ((toHalfBits(c.weight) & 0x7fff) << 16) | (c.visible ? 0x80000000 : 0)) >>>
  0
/** The reference of `candidateIndex`, `candidateVisible` and `candidateWeight`. */
export const unpackCandidateRef = (p: number): Candidate => ({
  index: p & 0xffff,
  visible: (p & 0x80000000) !== 0,
  weight: fromHalfBits((p >>> 16) & 0x7fff),
})

export interface Sampler {
  packed: number[]
  random: number[]
  weightSum: number
}
export const NO_LIGHT_PACKED = (32767 | 0x80000000) >>> 0

/** The reference of `initLightSamplerStratified`. */
export function initSamplerRef(random: number, count: number): Sampler {
  return {
    packed: Array(SAMPLER_MAX_SAMPLES).fill(NO_LIGHT_PACKED),
    random: Array.from({ length: SAMPLER_MAX_SAMPLES }, (_, i) =>
      i < count ? (random + i) / count : 0,
    ),
    weightSum: 0,
  }
}

/** The reference of `addLightSample`. */
export function addLightSampleRef(
  s: Sampler,
  weightIn: number,
  index: number,
  visible: boolean,
  radial: boolean,
  count: number,
  directionalRatio = 0,
  directionalMinWeight = 0,
) {
  let weight = weightIn
  if (!radial && directionalRatio > 0)
    weight = Math.min(weight, Math.max(s.weightSum, directionalMinWeight) * directionalRatio)
  const tau = s.weightSum / (s.weightSum + weight)
  s.weightSum += weight
  for (let i = 0; i < count; i++) {
    let r = s.random[i]!
    if (r < tau) r /= tau
    else {
      r = (r - tau) / (1 - tau)
      s.packed[i] = packCandidateRef({ index, visible, weight })
    }
    s.random[i] = Math.min(Math.max(r, 0), 0.9999)
  }
}

export interface LightSample {
  index: number
  weight: number
  visible: boolean
  guided: boolean
  volumetric: boolean
}
/** The reference of `packLightSample`. */
export const packLightSampleRef = (s: LightSample) =>
  ((s.index & 0x7fff) |
    ((s.volumetric ? 1 : 0) << 15) |
    ((toHalfBits(s.weight) & 0x7ffe) << 16) |
    ((s.guided ? 1 : 0) << 16) |
    ((s.visible ? 1 : 0) << 31)) >>>
  0
/** The reference of the readers of a packed light sample. */
export const unpackLightSampleRef = (p: number): LightSample => ({
  index: p & 0x7fff,
  volumetric: ((p >>> 15) & 1) === 1,
  weight: fromHalfBits((p >>> 16) & 0x7ffe),
  guided: ((p >>> 16) & 1) === 1,
  visible: p >>> 31 === 1,
})

export interface LightRay {
  distance: number
  uv: [number, number]
  type: number
  firstPerson: boolean
  completed: boolean
}
/** The reference of `packLightSampleRay`. */
export const packLightSampleRayRef = (r: LightRay) =>
  ((toHalfBits(r.distance) & 0x7fff) |
    ((r.completed ? 1 : 0) << 15) |
    ((Math.floor(r.uv[0] * 63 + 0.5) & 0x3f) << 16) |
    ((Math.floor(r.uv[1] * 63 + 0.5) & 0x3f) << 22) |
    ((r.firstPerson ? 1 : 0) << 28) |
    ((r.type & 3) << 30)) >>>
  0
export const unpackLightSampleRayRef = (p: number): LightRay => ({
  distance: fromHalfBits(p & 0x7fff),
  completed: ((p >>> 15) & 1) === 1,
  uv: [((p >>> 16) & 0x3f) / 63, ((p >>> 22) & 0x3f) / 63],
  firstPerson: ((p >>> 28) & 1) === 1,
  type: p >>> 30,
})
