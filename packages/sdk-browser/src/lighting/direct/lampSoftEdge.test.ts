// #1363: a point lamp's soft shadow across its penumbra, from the shipped PCSS (`lampSoftWgsl.ts`)
// and its comparison (`shadowCompare`) run through `shaderRun` over one face of the lamp's map —
// a half-plane caster five metres out, its edge on a page seam, a receiver plane at ten. Walked
// across the penumbra in steps of an eight-hundredth of it, the light never changes by more than
// 1/64 from one step to the next in one image — a binary tap flips by 1/16 however fine the step.
// The taps are the same every image: the view's jitter words carry no turn, so no per-frame
// pattern is left for the TAA to average.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { TAA_SAMPLES, taaJitter } from '../../taa/jitter.ts';
import { shadowJitterWords } from '../deferred/jitterWords.ts';
import { CONSTANTS, SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { POISSON_16 } from './pcfTaps.ts';

type V = number[];
/** A face `SIDE` texels wide seeing +z, 90° across; the lamp at the origin, near 0.1, range 100. */
const SIDE = 1024,
  NEAR = 0.1,
  FAR = 100,
  BLOCKER = 5,
  RECEIVER = 10,
  RADIUS = 0.3;
const K = (NEAR * FAR) / (FAR - NEAR);
/** Reverse perspective depth of axial distance `w` (`lampDiskSample`). */
const depthAt = (w: number) => K / w - NEAR / (FAR - NEAR);
/** The caster's texels: those whose centre looks at `x < 0`, five metres out. */
const texel = ([x]: V) => (((x + 0.5) / SIDE) * 2 - 1 < 0 ? depthAt(BLOCKER) : 0);
const face = (Q: V) => {
  const ndc = [Q[0] / Q[2], Q[1] / Q[2], depthAt(Q[2])];
  const t = [(ndc[0] * 0.5 + 0.5) * SIDE, (-ndc[1] * 0.5 + 0.5) * SIDE];
  const home = t.map((v) => Math.floor(v / CONSTANTS.SHADOW_PAGE));
  return {
    at: { map: { base: 0 }, t, home, Q, texel: 0 },
    ...{ clip: [0, 0, 0, Q[2]], ndc, face: 0, side: SIDE, inside: true },
  };
};
const scope = {
  ...CONSTANTS,
  POISSON: POISSON_16,
  shadows: { records: [{ info: [6, 1, NEAR, 0] }] },
  shadowTransmission: [1, 1, 1],
  shadowAtlas: 'atlas',
  shadowSampler: null,
  shadowTransmittance: 'transmittance',
  textureDimensions: (t: string) => (t === 'atlas' ? [SIDE, SIDE] : [1, 1]),
  textureLoad: (_: string, at: V) => texel(at),
  // `textureGatherCompare`'s texels around corner `uv·SIDE`, lit where the reference is not past them.
  textureGatherCompare: (_: string, __: null, uv: V, ___: number, reference: number) => {
    const [cx, cy] = uv.map((c) => Math.round(c * SIDE));
    const lit = (x: number, y: number) => (texel([x, y]) > reference ? 0 : 1);
    return [lit(cx - 1, cy), lit(cx, cy), lit(cx, cy - 1), lit(cx - 1, cy - 1)];
  },
  lampReadAt: (_: number, __: V, Q: V) => face(Q),
  shadowPageWord: () => 1,
  shadowOffset: () => [0, 0, 0],
  LampDisk: (T: V, B: V, distance: number, closest: number, search: number) => ({
    ...{ T, B, distance, closest, search },
  }),
  ShadowNeighbours: (x: number[], y: number[], d: number[]) => ({ x, y, d }),
  LampSample: (distance: number, blocked: boolean, through: V) => ({ distance, blocked, through }),
};
/** The light the shipped soft shadow lets through at `P`, the PCF's `-1` answered unshadowed. */
const TEST_WGSL = `fn softLit(P:vec3f)->f32{
 if(pointSoftShadow(0u,LAMP,P,vec3f(0.0,0.0,-1.0),0.0,${(2 * RECEIVER) / SIDE},0u)<0.0){return 1.0;}
 return shadowTransmission.x;
}`;
const NAMES = ['softLit', 'pointSoftShadow', 'lampDiskSample', 'lampSoftDisk', 'lampSoftMip'];
type Sample = { distance: number; blocked: boolean };
type Soft = {
  softLit: (P: V) => number;
  lampDiskSample: (...args: [number, object, V, V, V, number, boolean]) => Sample;
};
const LAMP = { positionRange: [0, 0, 0, FAR], shape: [RADIUS] };
/** The shipped soft shadow over the scope's face. */
const soft = shaderRun<Soft>(
  SHADOW_WGSL + TEST_WGSL,
  [
    ...NAMES,
    ...['lampSoftCompare', 'shadowSplitTap', 'shadowNeighbours', 'shadowPcfStep'],
    ...['shadowNeighbour', 'shadowCompare', 'shadowSample', 'shadowBilinear'],
    ...['shadowAtlasTexels', 'lampSoftCentre'],
  ],
  { ...scope, LAMP },
);
/** The soft shadow's light at receiver points `x`. */
const walk = (xs: number[]) => xs.map((x) => soft.softLit([x, 0.37, RECEIVER]));
/** The penumbra's width on the receiver, and 800 steps across it, a tenth of it past either side. */
const WIDTH = (2 * RADIUS * (RECEIVER - BLOCKER)) / BLOCKER;
const XS = Array.from({ length: 961 }, (_, i) => (i / 800 - 0.6) * WIDTH);
const largestStep = (light: number[]) =>
  Math.max(...light.slice(1).map((l, i) => Math.abs(l - light[i])));

test('a lamp soft-shadow edge has no step larger than a stated bound across its penumbra', () => {
  const still = walk(XS);
  assert.ok(still[0] < 0.02 && still.at(-1)! > 0.98, 'dark on the caster side, lit past it');
  // One image: a step of an eight-hundredth of the penumbra changes the light by at most 1/64.
  assert.ok(largestStep(still) <= 1 / 64, `one image: ${largestStep(still)}`);
  // Every phase of the jitter cycle hands the filters the same taps: no turn in the view's words.
  for (let k = 0; k < TAA_SAMPLES; k++)
    assert.deepEqual([...shadowJitterWords(taaJitter(k, new Float64Array(2))).slice(2)], [0, 0]);
});

test('a tap past a curved receiver’s terminator reads the map, at the disk’s width beyond it', () => {
  // A receiver on the caster's side, its plane holding the lamp's ray — the terminator of a curved
  // surface: the tap's ray never meets that plane. It is read a disk's width past the disk, where
  // the caster five metres out blocks it — never answered lit whatever the map holds.
  const P = [-1, 0.37, RECEIVER],
    N = [RECEIVER, 0, 1].map((c) => c / Math.hypot(RECEIVER, 1)),
    delta = [0, 0.1, 0];
  const grazing = soft.lampDiskSample(0, LAMP, P, N, delta, 0, false);
  assert.ok(grazing.blocked, 'the caster blocks the tap');
  assert.ok(Math.abs(grazing.distance - (BLOCKER * Math.hypot(...P)) / RECEIVER) < 0.05);
  // A receiver facing the lamp still reads its own plane: the bound leaves it be.
  const facing = soft.lampDiskSample(0, LAMP, P, [0, 0, -1], delta, 0, false);
  assert.ok(facing.blocked && Math.abs(facing.distance - grazing.distance) < 0.05);
});
