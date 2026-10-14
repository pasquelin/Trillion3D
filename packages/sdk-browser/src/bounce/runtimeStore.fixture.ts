// The run-time proxy's store as the shipped WGSL reads it in JavaScript (`runtimeRun.fixture.ts`), and the
// views its history is read under.
import { Mat } from '../texture/shaderRunMatrix.fixture.ts'
import type { Vec } from './runtimeOracle.fixture.ts'

/** The store of the answers as the shader reads it: its layers of words a pixel, keyed by texel. It
 *  answers its own loads and stores, as every texture the interpreter binds (`shaderRunBuiltins`). */
export function makeStore() {
  const words = new Map<string, number>()
  const key = (at: number[], layer: number) => `${at[0]},${at[1]},${layer}`
  const get = (at: number[], layer: number) => words.get(key(at, layer)) ?? 0
  return {
    words,
    get,
    load: (at: number[], layer: number) => [get(at, layer), 0, 0, 0],
    store: (at: number[], layer: number, value: number[]) =>
      void words.set(key(at, layer), value[0] >>> 0),
  }
}
export type Store = ReturnType<typeof makeStore>

/** The views the run reads, the image's and the one before's: the matrices the identity, so that a point's
 *  clip `w` — its key depth — is one and the pixel of `(x, y)` is `((x + 1)·2, (1 − y)·2)` in an image of
 *  4 × 4; a pixel a millimetre wide; the eye ten metres up `z`, where the radiance image's inverse puts it. */
const IDENTITY = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const EYE: Vec = [0, 0, 10]
/** A surface the tests answer: the point the image before saw at pixel (2, 0), facing the eye. */
export const point: Vec = [0, 0.75, 0.5]
export const facing: Vec = [0, 0, 1]

/** The reflection's view of a run: its run-time words (`ReflectionView.runtime`), a bare epoch reading the
 *  store in place. */
export const reflectionViewOf = (runtime: number | readonly number[]) => ({
  runtime: typeof runtime === 'number' ? [runtime, 0, 0, 0] : runtime,
  viewProj: IDENTITY,
  radianceViewProj: IDENTITY,
  radianceInverse: new Mat([1, 0, 0, 0, 0, 1, 0, 0, EYE[0], EYE[1], EYE[2], 1, 0, 0, 0, 1]),
  radiance: [4, 4, 0, 0],
  slab: [1e-3, 0, 0, 1],
})

/** The unit vector from `P` to the eye (`viewToEye`). */
export function viewToEye(P: Vec) {
  const d = EYE.map((e, k) => e - P[k]),
    l = Math.hypot(...d)
  return d.map((v) => v / l)
}
