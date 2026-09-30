// What a light adds to the irradiance every direction shares (`addLightIrradiance`); the lamp
// records are in `lightRecord.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Light } from './light.ts';
import { addLightIrradiance } from './lightRecord.ts';
import { IRRADIANCE_BAND, emptyIrradiance } from '../../scene/core/environment.ts';
import { near } from '../../math/near.fixture.ts';

/** The irradiance of `sh` at unit normal `n`, colour channel `c`. */
const irradiance = (sh: number[], n: number[], c: number) =>
  sh[c] * IRRADIANCE_BAND.constant +
  IRRADIANCE_BAND.linear * (sh[3 + c] * n[1] + sh[6 + c] * n[2] + sh[9 + c] * n[0]);

test('ambient, probe and sky lights add their irradiance, lamps none', () => {
  const sh = emptyIrradiance();
  assert.equal(
    addLightIrradiance(new Light('ambient', { color: [1, 0.5, 0.25], intensity: 2 }), sh),
    true,
  );
  near(
    [0, 1, 2].map((c) => irradiance(sh, [0, 0, 1], c)),
    [2, 1, 0.5],
    'ambient everywhere',
  );
  const probe = emptyIrradiance();
  addLightIrradiance(
    new Light('probe', { sh: Array.from({ length: 27 }, (_, i) => i), intensity: 2 }),
    probe,
  );
  assert.deepEqual(
    probe,
    Array.from({ length: 27 }, (_, i) => 2 * i),
  );
  const bare = emptyIrradiance();
  addLightIrradiance(new Light('probe', { color: [0, 1, 0] }), bare);
  near(
    [0, 1, 2].map((c) => irradiance(bare, [1, 0, 0], c)),
    [0, 1, 0],
    'a probe without coefficients',
  );
  const sky = emptyIrradiance();
  const hemisphere = new Light('hemisphere', {
    color: [1, 1, 1],
    groundColor: [0.5, 0, 0],
    intensity: 2,
    position: [3, 0, 0],
  });
  addLightIrradiance(hemisphere, sky);
  near(
    [0, 1, 2].map((c) => irradiance(sky, [1, 0, 0], c)),
    [2, 2, 2],
    'toward the sky',
  );
  near(
    [0, 1, 2].map((c) => irradiance(sky, [-1, 0, 0], c)),
    [1, 0, 0],
    'toward the ground',
  );
  const overhead = emptyIrradiance();
  addLightIrradiance(new Light('hemisphere', { position: [0, 0, 0] }), overhead);
  near([irradiance(overhead, [0, 1, 0], 0)], [1], 'at the origin the sky is up');
  const ambient = emptyIrradiance();
  addLightIrradiance(new Light('ambient', { color: [0, 0, 1], sh: Array(27).fill(5) }), ambient);
  near(
    [0, 1, 2].map((c) => irradiance(ambient, [0, 1, 0], c)),
    [0, 0, 1],
    'only a probe reads coefficients',
  );
  const untouched = emptyIrradiance();
  assert.equal(addLightIrradiance(new Light('point'), untouched), false);
  assert.equal(addLightIrradiance(new Light('ambient', { intensity: 0 }), untouched), false);
  assert.deepEqual(untouched, emptyIrradiance());
});
