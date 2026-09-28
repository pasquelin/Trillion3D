// A texture pool the scene fills: the option read, the budget taken of the working set, the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOptions } from './options.ts';
import { residentFraction, residentFractionBudget } from './poolFill.ts';
import { textures } from './summaryTextures.ts';
import type { ReglageVivant } from './report/types.ts';

const ROOT = '/tmp/trillion3d-bench';

test('a percentage is a fraction of the working set, a bare number stays MiB', () => {
  assert.equal(residentFraction('50%'), 0.5);
  assert.equal(residentFraction(' 12.5% '), 0.125);
  assert.equal(residentFraction('64'), null);
  for (const value of ['0%', '100%', '150%'])
    assert.throws(() => residentFraction(value), /strictly between/, value);
  const fraction = readOptions(['--pool-textures-vivant', '40%'], ROOT).settings.poolVivant;
  assert.deepEqual(fraction, {
    geometryPoolBytes: undefined,
    texturePoolBytes: undefined,
    textureResidentFraction: 0.4,
  });
  const bytes = readOptions(['--pool-textures-vivant', '64'], ROOT).settings.poolVivant;
  assert.equal(bytes?.texturePoolBytes, 64 * 1024 * 1024);
  assert.equal(bytes?.textureResidentFraction, undefined);
  assert.equal(readOptions([], ROOT).settings.poolVivant, null);
});

test('the budget follows what the pose holds, whatever the scene', () => {
  assert.equal(residentFractionBudget(0.5, 59_224_192), 29_612_096);
  assert.equal(residentFractionBudget(0.5, 7_268_928), 3_634_464);
  assert.equal(residentFractionBudget(0.001, 100), 1, 'never an empty budget');
  for (const resident of [0, null, undefined])
    assert.throws(() => residentFractionBudget(0.5, resident), /no texture tile/);
});

test('the summary says what the live texture pool asked, held, evicted and cost', () => {
  const reglage = {
    texturePool: {
      budgetBytes: 29_612_096,
      allocatedBytes: 50_331_648,
      clamp: 'minimum',
      layers: {},
    },
    evictedTiles: 212,
    durationMs: 3.456,
    imagesReprise: 9,
    residentTextureBytes: 59_224_192,
  } as unknown as ReglageVivant;
  const line = textures({}, { reglageVivant: reglage }).find((l) => l.includes('set live'));
  assert.equal(
    line,
    '- Texture pool set live: 29.6 MB asked (from 59.2 MB resident), 50.3 MB held (minimum); ' +
      '212 tiles evicted in 3.46 ms, pose held again after 9 frames',
  );
  assert.ok(!textures({}, {}).some((l) => l.includes('set live')), 'nothing set, nothing said');
});
