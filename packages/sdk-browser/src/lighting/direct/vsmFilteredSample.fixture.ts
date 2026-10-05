// Samples, positions and the reference filter the blended and water shadow read is judged by.
import { PCF_TAPS } from './pcfTaps.ts';
import { Mat } from '../../texture/shaderRun.fixture.ts';
import { type V, PAGE, LEVEL, MAP, mapped, World } from './vsmFilteredRead.fixture.ts';

export const FILTER = [
  'vsmFilterTaps',
  'vsmFilterTexelAt',
  'vsmFilterPage',
  'vsmFilterPageOf',
  'vsmFilterOwnPage',
  'vsmConsumerSlopeBiasAt',
  'testTransmission',
  'testReset',
];
export interface Filter {
  vsmFilterTaps: (r: object, sm: object, z: number, slope: V, clipmap: boolean) => number;
  testTransmission: () => V;
  testReset: () => void;
}

/** A sample at virtual texel position `p` of map `MAP`'s level `mip`, read in its page, mapped at
 *  physical page `physical`. */
export function sample(p: V, physical: V, mip = 0, handle = MAP) {
  const at = p.map(Math.floor);
  return {
    depth: 0,
    mipLevel: mip,
    handle: { id: handle, isSinglePage: false },
    valid: true,
    mapTexelXY: at,
    mapTexelPos: p,
    poolTexel: at.map((t, a) => physical[a] * PAGE + (t % PAGE)),
  };
}
/** A sample at `p` of a world whose physical pages are its virtual ones shifted by `shift`. */
export function pagedSample(p: V, shift: V = [3, 1]) {
  const s = sample(p, [0, 0]);
  s.poolTexel = s.mapTexelXY.map((t, a) => t + shift[a] * PAGE);
  return s;
}
export const REQUESTED = { id: MAP, isSinglePage: false };
export const FLAT = [0, 0, 1e9, 1];

/** Develop's filter at `p`: each tap's bilinear compare of four texels, averaged. */
export function developCoverage(p: V, lit: (t: V) => boolean) {
  let sum = 0;
  for (const [ox, oy] of PCF_TAPS) {
    const q = [p[0] + ox - 0.5, p[1] + oy - 0.5],
      c = q.map(Math.floor),
      f = [q[0] - c[0], q[1] - c[1]];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      sum +=
        (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (lit([c[0] + dx, c[1] + dy]) ? 1 : 0);
  }
  return sum / PCF_TAPS.length;
}

/** A world whose level-0 pages of `MAP` around page `page` are mapped one to one, physical page =
 *  virtual page + `shift`, and whose depth at a virtual texel is `depthAt`. */
export function pagedWorld(depthAt: (t: V) => number, shift: V = [3, 1]) {
  const world = new World();
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) world.set(MAP, 0, [x, y], mapped([x + shift[0], y + shift[1]]));
  world.depth = (physical) => depthAt(physical.map((t, a) => t - shift[a] * PAGE));
  return world;
}

/** Deterministic positions: page interiors, page edges and corners. */
export const POSITIONS: V[] = [
  [700.37, 900.81],
  [767.2, 812.6],
  [768.4, 1023.6],
  [895.51, 896.49],
  [1024.02, 1151.99],
  [640.5, 640.5],
];

/** A flat world for the whole read (`vsmShadowRead`): a sun straight down over level `MAP`
 *  (texel = 1 cm, depth 0.5 + y), its pages mapped one to one; every texel holds depth `depthAt`
 *  of it, `stored` by default, and the point read's sample and the traces read `stored`. */
export function sunWorld(stored: number, depthAt: (t: V) => number = () => stored) {
  const world = pagedWorld(depthAt);
  const uv = new Mat([
    0.01 / 1.6384,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0.01 / 1.6384,
    0,
    0,
    0.5,
    0.5,
    0.5,
    1,
  ]);
  const normal = new Mat([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const clip = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1]);
  const pd = {
    mapLevel: 5,
    levelsLeft: 4,
    shiftedToMapUv: uv,
    planesToMapUv: normal,
    lightViewToClip: clip,
    originShiftHigh: [0, 0, 0],
    originShiftLow: [0, 0, 0],
  };
  const stubs = {
    isSun: () => true,
    vsmHandleFromIdDirectional: (id: number) => ({ id, isSinglePage: false }),
    vsmProjectionOf: () => pd,
    vsmDistanceSqToOrigin: () => 1,
    vsmSampledLevel: () => 5.5,
    vsmSubtractHighLow: () => [0, 0, 0],
    vsmTransmissionThrough: () => [1, 1, 1],
    vsmReadClipmap: (h: { id: number }, uvs: V) => ({
      ...pagedSample(uvs.slice(0, 2).map((u) => u * LEVEL)),
      depth: stored,
      handle: h,
    }),
    // The traces, as the projection would answer them: every ray blocked or none.
    vsmTraceSun: () => ({ shadowFactor: stored > 0.5 ? 0 : 1 }),
    vsmTraceLocal: () => ({ shadowFactor: 1 }),
  };
  return { world, stubs };
}
/** The whole read and what it calls (`sunWorld`). */
export const SUN_READ = [
  'vsmShadowRead',
  'vsmShadowFactor',
  'vsmShadowFiltered',
  'vsmShadowTraced',
  'vsmPixelNoise',
  'vsmConsumerSlope',
  'vsmConsumerSlopeBias',
  ...FILTER,
];
