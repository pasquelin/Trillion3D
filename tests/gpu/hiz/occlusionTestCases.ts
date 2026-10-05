// The Hi-Z occlusion test's cases: a pyramid the engine's own packer builds (`packHizPyramid`),
// one tested box, and the verdict each case must produce.
import { DEPTH_CLEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';
import { packHizPyramid } from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts';
import {
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts';

const WIDTH = 33,
  HEIGHT = 19;
/** The pyramid level the box is expressed in: its rectangle spans that whole level. */
const LEVEL = 2;
// Reversed depth (`depthConvention.ts`): 1 is the near plane and `DEPTH_CLEAR` the far, and the
// pyramid keeps the farthest of a square, hence the minimum. An occluder at 0.6 fills the screen;
// the box's nearest point at 0.3 lies behind it.
const OCCLUDER_DEPTH = 0.6;
export const BOX_NEAREST = 0.3;

export interface OcclusionCase {
  name: string;
  pyramid: Float32Array<ArrayBuffer>;
  /** The box's rectangle, in texels of `LEVEL`, and that level's offset and width. */
  rectangle: [number, number, number, number];
  fineOffset: number;
  fineWidth: number;
  /** A box that crosses the near plane: the pyramid cannot judge it. */
  clipsNear: boolean;
  expected: number;
}

function occlusionCase(name: string, hole: boolean, clipsNear: boolean, expected: number) {
  const depth = Array.from({ length: HEIGHT }, () => Array<number>(WIDTH).fill(OCCLUDER_DEPTH));
  // A background hole, at the far plane: nothing behind it can be rejected.
  if (hole) depth[HEIGHT - 1][WIDTH - 1] = DEPTH_CLEAR;
  const { data, sizes, offsets } = packHizPyramid(depth);
  const [width, height] = sizes[LEVEL];
  return {
    name,
    pyramid: data,
    rectangle: [0, 0, width - 1, height - 1],
    fineOffset: offsets[LEVEL],
    fineWidth: width,
    clipsNear,
    expected,
  } satisfies OcclusionCase;
}

export const CASES: OcclusionCase[] = [
  occlusionCase('fully covered', false, false, VERDICT_REJECTED),
  occlusionCase('a background hole at the edge', true, false, VERDICT_KEPT),
  // A box the pyramid cannot judge stays drawn, never rejected.
  occlusionCase('crossing the near plane', false, true, VERDICT_KEPT),
];
