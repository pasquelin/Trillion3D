import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts'
import { builtins } from '../texture/shaderRunBuiltins.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { REFLECTION_RESOLVE_WGSL, REFLECTION_STILL_FRAMES } from './resolveWgsl.ts'

/** The record the trace writes of a pixel (`sampleWgsl.ts`): its identifier, its depth's bits. */
const ownerRecord = (id: number, depth: number) => [id, builtins.bitcast_u32(depth) as number, 0, 0]
const { reflectionPhase } = shaderRun<{ reflectionPhase: (seed: number) => number[] }>(
  REFLECTION_RESOLVE_WGSL,
  ['reflectionPhase'],
  {},
)
/** The pixel a half-resolution texel `q` serves at `phase` in an image of `size` (`reflectionPhase`). */
const ownerOf = (q: number[], phase: number, size: readonly number[]) =>
  [0, 1].map((k) => Math.min(q[k] * 2 + reflectionPhase(phase)[k], size[k] - 1))

/** The functions of the rough resolve `shaderRun` runs. */
const RESOLVE_FUNCTIONS = [
  'resolveRoughReflection',
  'previousDepthOf',
  'pointAt',
  'pixelPoint',
  'pointBefore',
  'roughSamples',
  'reflectionPhase',
  'placementOf',
  'maxChannel',
  'pixelToNdcInv',
  'transformHomogeneousPoint',
]

/** The shipped rough resolve run on the CPU at pixel (4, 4) of an 8 × 8 image by default: its inputs are
 *  `samples` (a function reads the pixel), `view`, `uv` and `motion`; `traced` lists the
 *  half-resolution texels the trace wrote, each with its pixel's record (`owners`), from the
 *  samples. `constants` overrides the shader's own. */
export function fixture(constants: Record<string, number> = {}) {
  const samples: Record<string, number | number[] | ((at: number[]) => number | number[])> = {
    ids: [0x107, 0, 0, 0],
    sampleColor: [2, 4, 6, 1],
    depth: 0.5,
    normalRough: [0, 0, 1, 0.5],
    previousIds: [0x107, 0, 0, 0],
    previousNormal: [0, 0, 1, 0.5],
    previousDepth: 0.5,
    historyColor: [10, 20, 30, 3],
    historyMoment: [0, 0, 0, 0],
  }
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const view = {
    prevViewProj: identity,
    invViewProj: identity,
    viewport: [8, 8, 1 / 8, 1 / 8],
    params: [1, REFLECTION_STILL_FRAMES, 0, 0],
    clip: [0, 0, 0, 0],
  }
  const motion = [identity]
  const uv = [0.5, 0.5, 1]
  /** Each texture's reads, by name. */
  const reads: Record<string, number> = {}
  const sample = (name: string, at: number[]) => {
    const value = samples[name]
    return typeof value === 'function' ? value(at) : value
  }
  /** The pixel a half-resolution texel `q` traced for at phase `params.w`. */
  const owner = (q: number[]) => ownerOf(q, view.params[3], view.viewport)
  const { resolveRoughReflection } = shaderRun<{
    resolveRoughReflection: (pixel: number[]) => { mean: number[]; moment: number }
  }>(REFLECTION_RESOLVE_WGSL, RESOLVE_FUNCTIONS, {
    ...wgslConstants(REFLECTION_RESOLVE_WGSL),
    ...constants,
    ...Object.fromEntries([...Object.keys(samples), 'owners'].map((key) => [key, key])),
    view,
    motion,
    neighbourhood: [0, 0, 0, 0],
    spread: [0, 0, 0],
    moment: 0,
    ReflectionResolved: (mean: number[], moment: number) => ({ mean, moment }),
    pages: [{ placement: 0 }],
    previousUv: () => uv,
    dpdx: () => 0,
    dpdy: () => 0,
    // Pixel (4, 4) at phase 0 was traced by the half-resolution texel (2, 2) alone. A sample
    // given as a function reads the pixel.
    textureLoad: (name: string, at: number[]) => {
      reads[name] = (reads[name] ?? 0) + 1
      if (name === 'sampleColor' && !traced.some((q) => q[0] === at[0] && q[1] === at[1]))
        return [0, 0, 0, 0]
      if (name !== 'owners') return sample(name, at)
      const pixel = owner(at)
      return ownerRecord((sample('ids', pixel) as number[])[0], sample('depth', pixel) as number)
    },
  })
  const traced = [[2, 2]]
  return {
    samples,
    view,
    uv,
    motion,
    traced,
    reads,
    owner,
    resolve: () => resolveRoughReflection([4, 4, 0, 1]).mean,
    /** The mean and the moment, the history's two targets. */
    resolved: () => resolveRoughReflection([4, 4, 0, 1]),
  }
}
