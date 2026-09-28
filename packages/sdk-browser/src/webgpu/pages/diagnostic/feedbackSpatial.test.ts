import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spatialMipCounts } from './feedbackSpatial.ts';

test('spatial feedback maps sampled r32uint ranks to requested and served mips', () => {
  const ranks = new Uint32Array(64 * 36).fill(1);
  let served = 0;
  const color = {
    pages: { entries: 1, tileOf: () => ({ slot: 0, level: 0, tx: 0, ty: 0 }) },
    servedLevel: () => served,
  };
  const textures = {
    color,
    data: { ...color, pages: { ...color.pages, entries: 0 } },
  } as unknown as Parameters<typeof spatialMipCounts>[3];
  const atLevel = spatialMipCounts(ranks, 64, 36, textures);
  assert.ok(atLevel.center.requested >= 64 && atLevel.periphery.requested >= 64);
  assert.equal(atLevel.center.atLevel, atLevel.center.requested);
  served = 1;
  assert.equal(
    spatialMipCounts(ranks, 64, 36, textures).center.mips['0->1'],
    atLevel.center.requested,
  );
  ranks.fill(2);
  assert.throws(() => spatialMipCounts(ranks, 64, 36, textures), /RANK_INVALID/);
});
