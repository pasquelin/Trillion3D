import test from 'node:test';
import assert from 'node:assert/strict';
import { StepWords, createWater } from './buoyancy.ts';
import { WAVE_FUNCTIONS, WaveUniforms, waveCode } from './waveCode.ts';
import { OCEAN, heightGap, kernels } from './waveCode.fixture.ts';
import { waveHeight, waveRest } from './surface.ts';
import { Waves } from './waves.ts';
import { BUOYANCY_WORDS, OP } from '../physics/layout.ts';

test('steepness is normalised so that Σ Qᵢ·Aᵢ·kᵢ stays at most 1', () => {
  assert.ok(Math.abs(new Waves(OCEAN).steepness - 1) < 1e-12, 'eight waves at 0.9 scaled to 1');
  const gentle = new Waves([{ direction: [1, 0], wavelength: 10, amplitude: 0.5, steepness: 0.4 }]);
  assert.ok(Math.abs(gentle.steepness - 0.4) < 1e-12, 'a sum below 1 is kept');
  assert.throws(
    () => new Waves([{ direction: [0, 0], wavelength: 1, amplitude: 1, steepness: 0 }]),
  );
  assert.throws(
    () => new Waves([{ direction: [1, 0], wavelength: 1, amplitude: 1, steepness: 2 }]),
  );
});

test('the height under a displaced point is that point’s height, at the steepest crest', () => {
  const waves = new Waves(OCEAN);
  waves.setTime(12.5);
  const o = new Float64Array(3);
  for (let i = 0; i < 2000; i++) {
    const x = (i % 50) * 1.37 - 30,
      z = Math.floor(i / 50) * 1.61 - 30;
    waves.offset(x, z, o);
    assert.ok(Math.abs(waveHeight(waves, x + o[0], z + o[2]) - o[1]) < 1e-3, `at ${x}, ${z}`);
  }
});

test('the generated code, in 32 bits, lands within 1 cm of the CPU height everywhere', () => {
  for (const t of [0, 3600.5, 86400.25])
    assert.ok(heightGap(OCEAN, t, 4000, 120) < 0.01, `at t = ${t}`);
});

test('the previous frame is the same code at t − dt, and the normal matches the CPU', () => {
  const waves = new Waves(OCEAN),
    { offset, normal } = kernels(waves.count);
  const u = new WaveUniforms(waves).update(100, 1 / 60);
  const cpu = new Float64Array(3);
  for (const [px, pz] of [
    [3, 4],
    [-120.5, 77],
    [900, -2500],
  ]) {
    waves.setTime(100 - 1 / 60);
    const before = offset(u, px, pz, 1);
    waves.offset(px, pz, cpu).forEach((v, i) => assert.ok(Math.abs(v - before[i]) < 1e-3));
    waves.setTime(100);
    const n = normal(u, px, pz, 0);
    waves.normal(px, pz, cpu).forEach((v, i) => assert.ok(Math.abs(v - n[i]) < 1e-3));
  }
});

test('WGSL and GLSL are printed from the same statements', () => {
  const wgsl = waveCode(4, 'wgsl', 'waves'),
    glsl = waveCode(4, 'glsl', 'uWaves');
  const body = (code: string) =>
    code
      .split('\n')
      .filter((line) => /^\s+\w+ = /.test(line))
      .map((line) => line.replace(/u?[wW]aves\[/g, 'W['));
  assert.deepEqual(body(wgsl), body(glsl));
  assert.equal(body(wgsl).length, 2 * 4 * 7);
  for (const name of Object.values(WAVE_FUNCTIONS)) {
    assert.match(wgsl, new RegExp(`fn ${name}\\(px: f32, pz: f32, previous: f32\\) -> vec3<f32>`));
    assert.match(glsl, new RegExp(`vec3 ${name}\\(float px, float pz, float previous\\)`));
  }
});

test('the step words carry one plane per piece, fitted to the waves, then the page’s commands', () => {
  const water = createWater({ waves: OCEAN.slice(0, 2), level: 3 });
  const piece = new Uint32Array([7, 1 << 16, 0, 0, 0, 0]);
  const f = new Float32Array(piece.buffer);
  f.set([10, -4, 0.5, 0.5], 2);
  const words = new StepWords();
  const length = words.write(water, f, 1, new Uint32Array([OP.wake, 7]));
  const out = new Float32Array(words.words.buffer);
  assert.deepEqual(
    [words.words[0], words.words[1], words.words[BUOYANCY_WORDS]],
    [OP.buoyancy, 1, 7],
  );
  assert.ok(Math.abs(out[BUOYANCY_WORDS + 3] - 3 - waveHeight(water.waves, 10, -4)) < 1e-5);
  // Over a 1 m square of 60 m and 31 m waves, the fitted plane is near the tangent plane.
  const rest = waveRest(water.waves, 10, -4, [0, 0, 0]);
  const normal = water.waves.normal(rest[0], rest[2], [0, 0, 0]);
  normal.forEach((v, i) => assert.ok(Math.abs(v - out[BUOYANCY_WORDS + 5 + i]) < 0.02));
  assert.deepEqual(Array.from(words.words.subarray(length - 2, length)), [OP.wake, 7]);
});
