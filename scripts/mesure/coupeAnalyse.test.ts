import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseCut } from './coupeAnalyse.ts';

const sha = (c: string) => c.repeat(64);

test('analyseCut counts instances and sorts by triangles', () => {
  const index = new Map([
    [sha('a'), { mesh: 0, material: 1, level: 0, triangles: 128 }],
    [sha('b'), { mesh: 1, material: 2, level: 2, triangles: 64 }],
  ]);
  const ids = [
    `../../objects/${sha('a')}.bin`,
    `../../objects/${sha('a')}.bin`,
    `../../objects/${sha('b')}.bin`,
  ];
  const r = analyseCut(ids, index, ['Wall', 'Foliage']);
  assert.equal(r.total, 320);
  assert.equal(r.unknown, 0);
  assert.deepEqual(r.byPrimitive, [
    { name: 'Wall', triangles: 256 },
    { name: 'Foliage', triangles: 64 },
  ]);
  assert.deepEqual(r.byLevel, [
    { name: '0', triangles: 256 },
    { name: '2', triangles: 64 },
  ]);
});

test('analyseCut names pages without a card and missing levels', () => {
  const index = new Map([[sha('a'), { mesh: 3, material: 0, level: -1, triangles: 12 }]]);
  const r = analyseCut([sha('a'), 'pas-un-sha'], index);
  assert.equal(r.total, 12);
  assert.equal(r.unknown, 1);
  assert.equal(r.byPrimitive[0].name, 'mesh 3');
  assert.equal(r.byLevel[0].name, 'no level');
});
