// Cases of the Hi-Z occlusion probe: a pyramid packed by the engine itself, and the verdict
// each must produce. The module is split from the proof so the proof holds under its line
// limit; it is never launched alone.
import { packHizPyramid } from '../../packages/sdk-browser/gpuHiz.ts';
import { DEPTH_CLEAR } from '../../packages/sdk-browser/depthConvention.ts';

export const width = 33,
  height = 19;

// REVERSED depth (`depthConvention.ts`): 1 is the near plane, `DEPTH_CLEAR` the far, and Hi-Z
// reduction keeps the farthest of a square, hence the MINIMUM. An occluder at 0.6 fills the
// screen; the tested box carries its nearest point at 0.3, hence BEHIND it.
const OCCLUDER_DEPTH = 0.6;
export const BOX_NEAREST = 0.3;

// A row's verdict is three values: 1 rejected, 2 drawn, 0 never written by this kernel.
const REJETEE = 1,
  DESSINEE = 2;

const makeCase = (hole: boolean) => {
  const depth = Array.from({ length: height }, () => Array(width).fill(OCCLUDER_DEPTH));
  // A BACKGROUND hole: at the far plane, so nothing can be rejected behind it.
  if (hole) depth[18][32] = DEPTH_CLEAR;
  const packed = packHizPyramid(depth);
  return {
    name: hole ? 'edge background hole' : 'fully covered',
    data: [...packed.data],
    size: packed.data.byteLength,
    expected: hole ? DESSINEE : REJETEE,
  };
};

export const cases = [
  makeCase(false),
  makeCase(true),
  // A row the pyramid cannot judge stays DRAWN, it is never rejected.
  { ...makeCase(false), name: 'near-plane crossing', clipsNear: true, expected: DESSINEE },
];
