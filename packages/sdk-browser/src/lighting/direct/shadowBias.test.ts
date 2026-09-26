// #456: the receiver's bias follows the map's texel and the receiver's slope — a normal offset and
// a slope-scaled depth margin, as Unreal's virtual shadow maps derive theirs —, never a length of
// the scene. The shader cannot run under node: `shadowBias.fixture.ts` restates the lines pinned
// here, and the tests read a sun over profiles of faces through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dot } from '../../../../sdk-core/src/math/projectionOracles.ts';
import { BIAS, DEVELOP_BIAS, RESTATED, SHADOW_WGSL, sunOverProfile } from './shadowBias.fixture.ts';
import type { Bias, Face } from './shadowBias.fixture.ts';
import { lampAt, lampOver } from './shadowLamp.fixture.ts';
import { SPLIT } from './shadowPages.fixture.ts';

const ZENITHS = [0.3, Math.PI / 4, 1.1, 1.4];
/** A box `high` × `thick` standing on a floor, its far side at x = 0; the floor last. */
const standing = (high: number, thick: number): Face[] => [
  { from: [-1, 0], to: [-thick, 0], normal: [0, 1] },
  { from: [-thick, 0], to: [-thick, high], normal: [-1, 0] },
  { from: [-thick, high], to: [0, high], normal: [0, 1] },
  { from: [0, high], to: [0, 0], normal: [1, 0] },
  { from: [0, 0], to: [1, 0], normal: [0, 1] },
];
/** A 1 cm step: the upper face ends over the lower one, and casts the step's shadow on it. */
const gap = 0.01,
  step: Face[] = [
    { from: [-1, gap], to: [0, gap], normal: [0, 1] },
    { from: [0, gap], to: [0, 0], normal: [1, 0] },
    { from: [0, 0], to: [1, 0], normal: [0, 1] },
  ];

test('the shadow read and page split the fixtures restate are the shader’s', () => {
  for (const line of [...RESTATED, ...SPLIT]) assert.ok(SHADOW_WGSL.includes(line), line);
});

/** Whether the first face is fully lit at 97 points along it, ends excluded. */
const clean = (read: (index: number, x: number) => number) =>
  Array.from({ length: 97 }, (_, k) => read(0, (k + 1) / 98)).every((lit) => lit === 1);

test('a plane shades no point of itself, at any slope and any texel', () => {
  for (const tilt of [0, 0.4, 0.9, 1.2])
    for (const zenith of [0, 0.3, 0.7, 1.4])
      for (const texel of [1e-4, 0.01, 1]) {
        const plane: Face = {
          from: [-50 * texel * Math.cos(tilt), -50 * texel * Math.sin(tilt)],
          to: [50 * texel * Math.cos(tilt), 50 * texel * Math.sin(tilt)],
          normal: [-Math.sin(tilt), Math.cos(tilt)],
        };
        assert.ok(clean(sunOverProfile([plane], zenith, texel)), `${tilt} ${zenith} ${texel}`);
      }
});

test('a plane facing the sun stays clean under the depth format’s rounding', () => {
  // A floor read at texels of a quarter and a sixtieth of a millimetre in a map 4 km deep: half a
  // texel is under the depth's float32 step there, and only the rounding floor keeps it lit.
  const floor: Face = { from: [-0.01, 0], to: [0.01, 0], normal: [0, 1] };
  for (const zenith of [0, 0.3, Math.PI / 4])
    for (const texel of [2 ** -12, 2 ** -16]) {
      assert.ok(clean(sunOverProfile([floor], zenith, texel, 4096)), `${zenith} ${texel}`);
    }
});

test('two parallel faces 1 cm apart: the upper one is clean at any texel up to the gap', () => {
  for (const zenith of ZENITHS)
    for (const texel of [gap / 32, gap / 8, gap / 2, gap]) {
      assert.ok(clean(sunOverProfile(step, zenith, texel)), `zenith ${zenith}, texel ${texel}`);
    }
});

test('a receiver turned from the light keeps the shadow of a caster above it', () => {
  // A small face turned away from a low sun — a toon surface still lights it —, under a slab a
  // metre up: the bias never reaches the slab, however grazing the light.
  for (const zenith of [0.3, 1.1, 1.4])
    for (const texel of [1e-3, 0.05]) {
      const light = [Math.sin(zenith), -Math.cos(zenith)],
        side = [-light[1] * texel, light[0] * texel];
      const turned: Face = { from: side.map((v) => -v), to: side, normal: light };
      const slab: Face = { from: [-50, 1], to: [50, 1], normal: [0, 1] };
      const read = sunOverProfile([turned, slab], zenith, texel);
      assert.equal(read(0, 0.5), 0, `${zenith} ${texel}`);
    }
});

test('a plane off a point light’s or a spot’s axis shades no point of itself', () => {
  // Facing the light or turned from it up to grazing, anywhere in the bottom face or in a wide
  // spot's: the depth along the face's axis changes across it even where the plane faces the light.
  const light = [0, 2, 0];
  for (const lamp of [lampAt(light), lampAt(light, [0, -1, 0], 1.2)])
    for (const [a, b] of [
      [0, 0],
      [0.4, 0.5],
      [0.7, 0.95],
      [0.95, 0.95],
    ])
      for (const tilt of [0, 0.5, 1, 1.45]) {
        // The normal turned by `tilt` from the light, toward a direction across the ray.
        const ray = [a, -1, b].map((v) => v / Math.hypot(a, 1, b));
        const P = ray.map((v, i) => light[i] + 3 * v),
          across = [1, 0, 0.3].map((v, i) => v - (ray[0] + 0.3 * ray[2]) * ray[i]);
        const normal = ray.map(
          (v, i) => -Math.cos(tilt) * v + (Math.sin(tilt) * across[i]) / Math.hypot(...across),
        );
        const read = lampOver(lamp, [{ at: P, normal }]);
        for (let k = 0; k < 20; k++) {
          const step = [1.3e-4 * k, 0, 7e-5 * k],
            off = dot(step, normal);
          const on = P.map((v, i) => v + step[i] - off * normal[i]);
          assert.equal(read(on, normal, 0).lit, 1, `${lamp.kind} ${a} ${b} ${tilt}: acne at ${on}`);
        }
      }
});

/** Length across the light, in map texels, of a floor's misread light: the read's lit fraction
 *  against a ray-cast, summed unrounded so a partial leak or partial acne counts. */
function edgeError(faces: Face[], zenith: number, texel: number, bias: Bias, length: number) {
  const read = sunOverProfile(faces, zenith, texel, 0, bias),
    floor = faces.length - 1;
  let wrong = 0;
  for (let x = texel / 4; x < length; x += texel / 2)
    wrong += Math.abs(read(floor, x) - read(floor, x, true));
  return (wrong / 2) * Math.cos(zenith);
}

test('the new bias puts every shadow edge nearer a ray-cast of its casters than develop’s', () => {
  // The observatory's 1 cm steps, a 5 cm pawn, sun 51° from vertical, a wall up to 78° (grazing):
  // edges and contacts alike, where develop's bias let light through or shaded a clean face.
  const cases: [Face[], number[], number[], number][] = [
    [step, ZENITHS, [gap / 32, gap / 16, gap / 8, gap / 4], 0.07],
    [standing(0.05, 0.02), [0.89], [2.5e-4, 4e-4, 1e-3], 0.1],
    [standing(0.1, 0.002), [Math.PI / 4, 1.1, 1.36, 1.4], [2.5e-4, 1e-3, 4e-3], 0.7],
  ];
  for (const [faces, zeniths, texels, length] of cases) {
    const errors = (bias: Bias) =>
      zeniths.flatMap((z) => texels.map((t) => edgeError(faces, z, t, bias, length)));
    const [now, before] = [errors(BIAS), errors(DEVELOP_BIAS)];
    now.forEach((e, i) => assert.ok(e < Math.min(before[i], 5), `${i}: ${e} against ${before[i]}`));
  }
});
