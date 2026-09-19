import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseCut } from './coupeAnalyse.mjs';
import { blocCoupe, verdictWhisperwind } from './rapportGlobalCoupe.mjs';

const sha = (c) => c.repeat(64);
const index = new Map([
  [sha('a'), { mesh: 0, material: 1, level: 0, triangles: 128 }],
  [sha('b'), { mesh: 1, material: 2, level: 2, triangles: 64 }],
]);
const ids = [sha('a'), sha('a'), sha('b'), sha('c')].map((s) => `../../objects/${s}.bin`);

test('the cut section reads what analyseCut publishes: names, levels and unknown pages', () => {
  const analyse = analyseCut(ids, index, ['Wall', 'Foliage']);
  const item = {
    scene: 'whisperwind-village',
    analyse,
    reading: { triangles: 300 },
    view: 'generale',
  };
  const bloc = blocCoupe(item);
  assert.match(bloc, /generale view, 1 px threshold: 320 triangles in the cut \(300 published/);
  assert.match(bloc, /1 pages with no record/);
  assert.match(bloc, /<th scope="row">Wall<\/th><td>256<\/td>/);
  assert.match(bloc, /<th scope="row">2<\/th><td>64<\/td>/);
  assert.match(verdictWhisperwind(item), /top item is <strong>Wall<\/strong> \(80 %\)/);
});

test('a missing run or cut is written as unmeasured, never invented', () => {
  assert.match(blocCoupe({ scene: 's', analyse: null, reading: null, view: null }), /run missing/);
  assert.match(
    blocCoupe({ scene: 's', analyse: null, reading: {}, view: 'sol' }),
    /view sol missing/,
  );
  assert.equal(verdictWhisperwind({ scene: 's', analyse: null }), '');
});
