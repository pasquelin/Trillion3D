// #456: the receiver's bias follows the map's texel and the receiver's slope — a normal offset and
// a slope-scaled depth margin, as Unreal's virtual shadow maps derive theirs —, never a length of
// the scene. The shader cannot run under node: `shadowBias.fixture.ts` restates the lines pinned
// here, and the tests read a sun over profiles of faces through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESTATED,
  SHADOW_WGSL,
  pointLampOver,
  sunOverProfile,
  type Face,
} from './shadowBias.fixture.ts';

const ZENITHS = [0.3, Math.PI / 4, 1.1];

test('the shadow read restated by the fixture is the shader’s', () => {
  for (const line of RESTATED) assert.ok(SHADOW_WGSL.includes(line), line);
});

/** Lit fractions at `samples` points along face `index`, ends excluded. */
const along = (read: (index: number, x: number) => number, index: number, samples = 97) =>
  Array.from({ length: samples }, (_, k) => read(index, (k + 1) / (samples + 1)));

test('a plane shades no point of itself, at any slope and any texel', () => {
  for (const tilt of [0, 0.4, 0.9, 1.2])
    for (const zenith of [0, 0.3, 0.7])
      for (const texel of [1e-4, 0.01, 1]) {
        const plane: Face = {
          from: [-50 * texel * Math.cos(tilt), -50 * texel * Math.sin(tilt)],
          to: [50 * texel * Math.cos(tilt), 50 * texel * Math.sin(tilt)],
          normal: [-Math.sin(tilt), Math.cos(tilt)],
        };
        const read = sunOverProfile([plane], zenith, texel);
        assert.deepEqual(new Set(along(read, 0)), new Set([1]), `${tilt} ${zenith} ${texel}`);
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
      const acne = along(read, 0).filter((lit) => lit < 1);
      assert.deepEqual(acne, [], `zenith ${zenith}, texel ${texel}: acne on the upper face`);
      assert.equal(read(2, shadow + 4 * texel), 1, 'the lower face past the shadow is lit');
    }
    // Where the step's shadow spans 16 texels, its middle is shadow, not light let through.
    const texel = shadow / 16;
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
  for (const zenith of [Math.PI / 4, 1.1])
    for (const texel of [5e-4, 1e-3, 4e-3]) {
      const read = sunOverProfile(wall, zenith, texel);
      for (let texels = 5; texels <= 10; texels++)
        assert.equal(read(4, texels * texel), 0, `${zenith} ${texel}: ${texels} texels out`);
      assert.equal(read(4, 0.5), 1, 'the floor past the shadow is lit');
    }
});

test('a plane off a lamp face’s axis shades no point of itself', () => {
  // Facing the light or tilted from it, anywhere in the bottom face: the depth along the face's
  // axis changes across the face even where the plane faces the light.
  const light = [0, 2, 0];
  for (const [a, b] of [
    [0, 0],
    [0.4, 0.5],
    [0.7, 0.95],
    [0.95, 0.95],
  ])
    for (const tilt of [0, 0.5, 1]) {
      const ray = [a, -1, b].map((v) => v / Math.hypot(a, 1, b));
      const P = ray.map((v, i) => light[i] + 3 * v),
        N = [tilt - ray[0], -ray[1], 0.3 * tilt - ray[2]];
      const normal = N.map((v) => v / Math.hypot(...N));
      const read = pointLampOver(light, [{ at: P, normal }]);
      for (let k = 0; k < 20; k++) {
        const step = [1.3e-4 * k, 0, 7e-5 * k],
          off = step.reduce((sum, v, i) => sum + v * normal[i], 0);
        const on = P.map((v, i) => v + step[i] - off * normal[i]);
        assert.equal(read(on, normal, 0).lit, 1, `${a} ${b} ${tilt}: acne at ${on}`);
      }
    }
});
