// #1363: a point lamp's soft shadow across its penumbra, from the shipped PCSS (`lampSoftWgsl.ts`)
// and its comparison (`shadowCompare`) run through `shaderRun` over one face of the lamp's map —
// a half-plane caster five metres out, its edge on a page seam, a receiver plane at ten. Walked
// across the penumbra in steps of an eight-hundredth of it, the light never changes by more than
// 1/64 from one step to the next in one image — a binary tap flips by 1/16 however fine the step —,
// nor by more than 1/128 averaged over the turns of a jitter cycle, the image the TAA accumulates;
// and the turns do change each image, which the history averages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { TAA_SAMPLES, taaJitter } from '../../taa/jitter.ts';
import { shadowJitterWords } from '../deferred/view.ts';
import { CONSTANTS, SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { POISSON_16 } from './shadowWgsl.ts';

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
  shadowRotation: [1, 0],
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
 if(pointSoftShadow(0u,LAMP,P,vec3f(0.0,0.0,-1.0),0u)<0.0){return 1.0;}
 return shadowTransmission.x;
}`;
const NAMES = ['softLit', 'pointSoftShadow', 'lampDiskSample', 'lampSoftDisk', 'shadowRotated'];
/** The soft shadow's light at receiver points `x`, its taps turned by `rotation`. */
function walk(xs: number[], rotation: V) {
  const { softLit } = shaderRun<{ softLit: (P: V) => number }>(
    SHADOW_WGSL + TEST_WGSL,
    [
      ...NAMES,
      'lampSoftCompare',
      'shadowSplitTap',
      'shadowNeighbours',
      'shadowPcfStep',
      'shadowNeighbour',
      'shadowCompare',
      'shadowSample',
      'shadowBilinear',
      'shadowAtlasTexels',
    ],
    {
      ...scope,
      shadowRotation: rotation,
      LAMP: { positionRange: [0, 0, 0, FAR], shape: [RADIUS] },
    },
  );
  return xs.map((x) => softLit([x, 0.37, RECEIVER]));
}
/** The penumbra's width on the receiver, and 800 steps across it, a tenth of it past either side. */
const WIDTH = (2 * RADIUS * (RECEIVER - BLOCKER)) / BLOCKER;
const XS = Array.from({ length: 961 }, (_, i) => (i / 800 - 0.6) * WIDTH);
const largestStep = (light: number[]) =>
  Math.max(...light.slice(1).map((l, i) => Math.abs(l - light[i])));
const TURNS = Array.from({ length: TAA_SAMPLES }, (_, k) =>
  shadowJitterWords(taaJitter(k, new Float64Array(2))).slice(2),
);

test('a lamp soft-shadow edge has no step larger than a stated bound across its penumbra', () => {
  const still = walk(XS, [1, 0]);
  assert.ok(still[0] < 0.02 && still.at(-1)! > 0.98, 'dark on the caster side, lit past it');
  // One image: a step of an eight-hundredth of the penumbra changes the light by at most 1/64.
  assert.ok(largestStep(still) <= 1 / 64, `one image: ${largestStep(still)}`);
  const turned = TURNS.map((rotation) => walk(XS, rotation));
  for (const light of turned) assert.ok(largestStep(light) <= 1 / 64, `${largestStep(light)}`);
  // The image the TAA accumulates over the cycle's turns: at most 1/128.
  const average = XS.map((_, i) => turned.reduce((sum, light) => sum + light[i], 0) / TAA_SAMPLES);
  assert.ok(largestStep(average) <= 1 / 128, `accumulated: ${largestStep(average)}`);
  // The turns move the taps: the phases differ, and their history is what the image shows.
  assert.ok(turned.some((light) => light.some((l, i) => Math.abs(l - still[i]) > 1e-3)));
});
