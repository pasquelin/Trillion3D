import test from 'node:test';
import assert from 'node:assert/strict';
import { analyserCoupe } from './coupeAnalyse.mjs';

const sha = (c) => c.repeat(64);

test('analyserCoupe compte les instances et range par triangles', () => {
  const index = new Map([
    [sha('a'), { mesh: 0, material: 1, level: 0, triangles: 128 }],
    [sha('b'), { mesh: 1, material: 2, level: 2, triangles: 64 }],
  ]);
  const ids = [
    `../../objects/${sha('a')}.bin`,
    `../../objects/${sha('a')}.bin`,
    `../../objects/${sha('b')}.bin`,
  ];
  const r = analyserCoupe(ids, index, ['Wall', 'Foliage']);
  assert.equal(r.total, 320);
  assert.equal(r.inconnues, 0);
  assert.deepEqual(r.parPrimitive, [
    { nom: 'Wall', triangles: 256 },
    { nom: 'Foliage', triangles: 64 },
  ]);
  assert.deepEqual(r.parNiveau, [
    { nom: '0', triangles: 256 },
    { nom: '2', triangles: 64 },
  ]);
});

test('analyserCoupe nomme les pages sans fiche et les niveaux absents', () => {
  const index = new Map([[sha('a'), { mesh: 3, material: 0, level: -1, triangles: 12 }]]);
  const r = analyserCoupe([sha('a'), 'pas-un-sha'], index);
  assert.equal(r.total, 12);
  assert.equal(r.inconnues, 1);
  assert.equal(r.parPrimitive[0].nom, 'mesh 3');
  assert.equal(r.parNiveau[0].nom, 'sans niveau');
});
