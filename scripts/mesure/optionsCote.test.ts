// Per-side texture compression: what lets one execution pit RGBA8 pools against block pools on
// the same dist, the same cache and the same poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipSide, sideReport } from './optionsCote.ts';

const equip = (name: string, flags: Record<string, string>) => {
  return equipSide({ name } as never, new Map(Object.entries(flags)), { engine: 'webgpu' });
};

test('a side takes its own compression, then the campaign one, otherwise the engine choice', () => {
  assert.equal(equip('avant', {}).compression, null);
  assert.equal(equip('avant', { compression: 'none' }).compression, 'none');
  const own = equip('apres', { compression: 'none', 'compression-apres': 'astc' });
  assert.equal(own.compression, 'astc');
  assert.equal(sideReport(own)[1].compression, 'astc');
  assert.throws(
    () => equip('apres', { 'compression-apres': 'dxt1' }),
    /must be auto, bc7, astc, none/,
  );
  assert.throws(() => equip('avant', { erreur: 'other' }), /must be certifiee, reference/);
});
