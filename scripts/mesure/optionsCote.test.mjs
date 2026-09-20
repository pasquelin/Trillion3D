// Per-side texture compression: what lets one execution pit RGBA8 pools against block pools on
// the same dist, the same cache and the same poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipSide, sideReport } from './optionsCote.mjs';

const equip = (name, flags) => {
  const side = { name };
  equipSide(side, new Map(Object.entries(flags)), { engine: 'webgpu' });
  return side;
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
});
