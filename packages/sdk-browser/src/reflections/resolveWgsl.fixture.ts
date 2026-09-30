import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import { REFLECTION_RESOLVE_WGSL, REFLECTION_STILL_FRAMES } from './resolveWgsl.ts';

/** The shipped rough resolve run on the CPU at pixel (4, 4) of an 8 × 8 image: its inputs are
 *  `samples` (a function reads the pixel), `view`, `uv` and `motion`; `traced` lists the
 *  half-resolution texels the trace wrote. */
export function fixture() {
  const samples: Record<string, number | number[] | ((at: number[]) => number | number[])> = {
    ids: [0x107, 0, 0, 0],
    sampleColor: [2, 4, 6, 1],
    depth: 0.5,
    normalRough: [0, 0, 1, 0.5],
    previousIds: [0x107, 0, 0, 0],
    previousNormal: [0, 0, 1, 0.5],
    previousDepth: 0.5,
    historyColor: [10, 20, 30, 3],
  };
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const view = {
    prevViewProj: identity,
    invViewProj: identity,
    viewport: [8, 8, 1 / 8, 1 / 8],
    params: [1, REFLECTION_STILL_FRAMES, 0, 0],
  };
  const motion = [identity];
  const uv = [0.5, 0.5, 1];
  const { resolveRoughReflection } = shaderRun<{
    resolveRoughReflection: (pixel: number[]) => number[];
  }>(
    REFLECTION_RESOLVE_WGSL,
    [
      'resolveRoughReflection',
      'previousDepthOf',
      'pointAt',
      'clipAt',
      'roughSamples',
      'reflectionPhase',
      'placementOf',
    ],
    {
      ...wgslConstants(REFLECTION_RESOLVE_WGSL),
      ...Object.fromEntries(Object.keys(samples).map((key) => [key, key])),
      view,
      motion,
      pages: [{ placement: 0 }],
      previousUv: () => uv,
      dpdx: () => 0,
      dpdy: () => 0,
      // Pixel (4, 4) at phase 0 was traced by the half-resolution texel (2, 2) alone. A sample
      // given as a function reads the pixel.
      textureLoad: (name: string, at: number[]) => {
        const value = samples[name];
        if (name === 'sampleColor' && !traced.some((q) => q[0] === at[0] && q[1] === at[1]))
          return [0, 0, 0, 0];
        return typeof value === 'function' ? value(at) : value;
      },
    },
  );
  const traced = [[2, 2]];
  return {
    samples,
    view,
    uv,
    motion,
    traced,
    resolve: () => resolveRoughReflection([4, 4, 0, 1]),
  };
}
