import test from 'node:test';
import assert from 'node:assert/strict';
import { deformationSlotBytes } from './slotLayout.ts';
import type { PageRec } from '../page/selection/selection.ts';

const page = (url: string, count: number, deformed = true) =>
  ({
    url,
    geometryPage: { url, vertexCount: count },
    sourceMesh: deformed ? { morphTargetInfluences: [0] } : { geometry: { usage: 'static' } },
  }) as unknown as PageRec;

test('shared compressed slots reserve disjoint outputs for every deformed placement', () => {
  const a = page('shared', 3),
    b = page('shared', 3),
    c = page('other', 4);
  const staticPage = page('shared', 5, false);
  assert.equal(deformationSlotBytes([a, b, c, staticPage], 128), 128 + 2 * 3 * 11 * 4);
  assert.deepEqual(a.deformationOutput, { from: 34, count: 3 });
  assert.deepEqual(b.deformationOutput, { from: 67, count: 3 });
  assert.deepEqual(c.deformationOutput, { from: 34, count: 4 });
  assert.equal(staticPage.deformationOutput, undefined);
});

test('static scenes retain their exact cache slot size', () => {
  assert.equal(deformationSlotBytes([page('static', 1024, false)], 128), 128);
});
