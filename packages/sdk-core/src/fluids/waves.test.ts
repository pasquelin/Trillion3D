import test from 'node:test';
import assert from 'node:assert/strict';
import { StepWords, createWater, sliceLength } from './buoyancy.ts';
import { OCEAN } from './waves.fixture.ts';
import { waveHeight, waveRest } from './surface.ts';
import { Waves } from './waves.ts';
import { WaterSurface } from './waterSurface.ts';
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

test('a thin piece is sampled over a square a slice fraction wide: its plane stays finite', () => {
  const water = createWater({ waves: OCEAN, level: 0 });
  assert.equal(water.sample, sliceLength(water) / 25);
  assert.equal(createWater({ waves: [], level: 0 }).sample, 1, 'level water: any square');
  const piece = new Float32Array([0, 0, 5, 5, 0, 0]);
  const words = new StepWords();
  words.write(water, piece, 1, null);
  const normal = new Float32Array(words.words.buffer).subarray(
    BUOYANCY_WORDS + 5,
    BUOYANCY_WORDS + 8,
  );
  assert.ok(normal.every(Number.isFinite) && normal[1] > 0.5, `normal ${normal}`);
});

test('the drawn surface is the waves buoyancy reads: its points lie at its heights', () => {
  const surface = new WaterSurface({ waves: OCEAN, level: 2 }).setTime(7.25);
  const waves = new Waves(OCEAN);
  waves.setTime(7.25);
  const p = new Float64Array(3);
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 1.9 - 19,
      z = Math.floor(i / 20) * 2.3 - 23;
    surface.point(x, z, p);
    assert.ok(Math.abs(p[1] - 2 - waveHeight(waves, p[0], p[2])) < 1e-3, `at ${x}, ${z}`);
    assert.ok(Math.abs(surface.height(p[0], p[2]) - p[1]) < 1e-3);
  }
  assert.equal(surface.crest, waves.crest);
  assert.throws(() => new WaterSurface({ waves: [{ ...OCEAN[0], steepness: 2 }], level: 0 }));
});
