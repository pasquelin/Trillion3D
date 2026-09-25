// #456: the receiver's bias follows the map's texel and the receiver's slope — a normal offset and
// a slope-scaled depth margin, as Unreal's virtual shadow maps derive theirs —, never a length of
// the scene. The shader cannot run under node: `shadowBias.fixture.ts` restates the lines pinned
// here, and the tests read a sun over profiles of faces through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dot } from '../../../../sdk-core/src/math/projectionOracles.ts';
import { RESTATED, SHADOW_WGSL, sunOverProfile, type Face } from './shadowBias.fixture.ts';
import { lampAt, lampOver } from './shadowLamp.fixture.ts';
import { SPLIT } from './shadowPages.fixture.ts';

const ZENITHS = [0.3, Math.PI / 4, 1.1, 1.4];

test('the shadow read and page split the fixtures restate are the shader’s', () => {
  for (const line of [...RESTATED, ...SPLIT]) assert.ok(SHADOW_WGSL.includes(line), line);
});

/** Lit fractions at `samples` points along face `index`, ends excluded. */
const samplesAlong = (read: (index: number, x: number) => number, index: number, samples = 97) =>
  Array.from({ length: samples }, (_, k) => read(index, (k + 1) / (samples + 1)));

test('a plane shades no point of itself, at any slope and any texel', () => {
  for (const tilt of [0, 0.4, 0.9, 1.2])
    for (const zenith of [0, 0.3, 0.7, 1.4])
      for (const texel of [1e-4, 0.01, 1]) {
        const plane: Face = {
          from: [-50 * texel * Math.cos(tilt), -50 * texel * Math.sin(tilt)],
          to: [50 * texel * Math.cos(tilt), 50 * texel * Math.sin(tilt)],
          normal: [-Math.sin(tilt), Math.cos(tilt)],
        };
        const read = sunOverProfile([plane], zenith, texel);
        assert.deepEqual(
          new Set(samplesAlong(read, 0)),
          new Set([1]),
          `${tilt} ${zenith} ${texel}`,
        );
      }
});

test('a plane facing the sun stays clean under the depth format’s rounding', () => {
  // A floor read at texels of a quarter and a sixtieth of a millimetre in a map 4 km deep: half a
  // texel is under the depth's float32 step there, and only the rounding floor keeps it lit.
  const floor: Face = { from: [-0.01, 0], to: [0.01, 0], normal: [0, 1] };
  for (const zenith of [0, 0.3, Math.PI / 4])
    for (const texel of [2 ** -12, 2 ** -16]) {
      const read = sunOverProfile([floor], zenith, texel, 4096);
      assert.deepEqual(new Set(samplesAlong(read, 0)), new Set([1]), `${zenith} ${texel}`);
    }
});

test('two parallel faces 1 cm apart: the upper one is clean, the lower one keeps its shadow', () => {
  // A 1 cm step: the upper face ends over the lower one, and casts the step's shadow on it.
  const gap = 0.01;
  const step: Face[] = [
    { from: [-1, gap], to: [0, gap], normal: [0, 1] },
    { from: [0, gap], to: [0, 0], normal: [1, 0] },
    { from: [0, 0], to: [1, 0], normal: [0, 1] },
  ];
  for (const zenith of ZENITHS) {
    const shadow = gap * Math.tan(zenith);
    for (const texel of [gap / 32, gap / 8, gap / 2, gap]) {
      const read = sunOverProfile(step, zenith, texel);
      const acne = samplesAlong(read, 0).filter((lit) => lit < 1);
      assert.deepEqual(acne, [], `zenith ${zenith}, texel ${texel}: acne on the upper face`);
      assert.equal(read(2, shadow + 4 * texel), 1, 'the lower face past the shadow is lit');
    }
    // Where the step is 16 texels high, its shadow's middle is shadow, not light let through.
    const texel = gap / 16;
    assert.equal(sunOverProfile(step, zenith, texel)(2, shadow / 2), 0, `zenith ${zenith}`);
  }
});

test('a caster standing on its receiver keeps its contact, a few texels from its foot', () => {
  // A wall 10 cm high and 2 mm thick on the floor; the sun casts its shadow toward +x.
  const high = 0.1,
    thick = 0.002;
  const wall: Face[] = [
    { from: [-1, 0], to: [-thick, 0], normal: [0, 1] },
    { from: [-thick, 0], to: [-thick, high], normal: [-1, 0] },
    { from: [-thick, high], to: [0, high], normal: [0, 1] },
    { from: [0, high], to: [0, 0], normal: [1, 0] },
    { from: [0, 0], to: [1, 0], normal: [0, 1] },
  ];
  for (const zenith of [Math.PI / 4, 1.1, 1.4])
    for (const texel of [5e-4, 1e-3, 4e-3]) {
      const read = sunOverProfile(wall, zenith, texel);
      for (let texels = 5; texels <= 10; texels++)
        assert.equal(read(4, texels * texel), 0, `${zenith} ${texel}: ${texels} texels out`);
      assert.equal(read(4, high * Math.tan(zenith) + 0.1), 1, 'the floor past the shadow is lit');
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
