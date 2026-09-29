// Per-side texture compression and render scale: what lets one execution pit RGBA8 pools against
// block pools, or a native frame against a reconstructed one, on the same dist, cache and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipSide, sideReport } from './sideOptions.ts';

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

// #816: one run pits the native frame against one drawn below the display and reconstructed.
test('a side takes its own render scale, then the campaign one, otherwise the display', () => {
  assert.equal(equip('avant', {}).renderScale, null);
  assert.equal(equip('avant', { echelle: '0.5' }).renderScale, 0.5);
  const own = equip('apres', { echelle: '1', 'echelle-apres': '0.67' });
  assert.equal(own.renderScale, 0.67);
  assert.equal(sideReport(own)[1].echelle, 0.67);
  for (const wrong of ['0.4', '1.5', 'half'])
    assert.throws(() => equip('apres', { 'echelle-apres': wrong }), /must be in \[0\.5, 1\]/);
});
