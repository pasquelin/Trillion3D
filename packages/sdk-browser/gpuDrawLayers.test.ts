import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  evaluateDrawCompact,
  slotCount,
  type DrawItem,
} from './gpuDraw.ts';
import { drawShader } from './gpuDrawShader.ts';

// Comportement 16 : un item de couche n va au slot bin + 3·rest + 6·n, et layerSlots = 1
// (une scène sans couche coplanaire empilée) reproduit exactement les six slots d'avant.
test('evaluateDrawCompact places layer n items at slot bin + 3*rest + 6*n', () => {
  const items: DrawItem[] = [
    { pageIndex: 10, bin: BIN_BACK, rest: 0, layer: 0 },
    { pageIndex: 11, bin: BIN_FRONT, rest: 1, layer: 1 },
    { pageIndex: 12, bin: BIN_NONE, rest: 0, layer: 2 },
  ];
  const result = evaluateDrawCompact(items, 768, 8, 3);
  assert.equal(result.counts.length, slotCount(3));
  assert.equal(result.counts.length, 18);
  const slotBack0 = 0 * 3 + BIN_BACK + 6 * 0;
  const slotFront1 = 1 * 3 + BIN_FRONT + 6 * 1;
  const slotNone2 = 0 * 3 + BIN_NONE + 6 * 2;
  assert.equal(result.counts[slotBack0], 1);
  assert.equal(result.counts[slotFront1], 1);
  assert.equal(result.counts[slotNone2], 1);
  assert.equal(
    result.counts.reduce((sum, count) => sum + count, 0),
    items.length,
  );
});

test('layerSlots = 1 collapses every layer into the original six slots', () => {
  const items: DrawItem[] = [
    { pageIndex: 0, bin: BIN_BACK, rest: 0, layer: 0 },
    { pageIndex: 1, bin: BIN_BACK, rest: 0, layer: 5 },
    { pageIndex: 2, bin: BIN_BACK, rest: 0, layer: 15 },
  ];
  const result = evaluateDrawCompact(items, 768, 8, 1);
  assert.equal(result.counts.length, 6);
  assert.equal(result.counts.length, slotCount(1));
  // Les trois items, de couches différentes, atterrissent tous dans le même slot bin+3*rest.
  assert.equal(result.counts[BIN_BACK], 3);
  assert.deepEqual([...result.instances], [0, 1, 2]);
});

// Comportement 17 : drawShader(k) ouvre exactement 6k slots dans son propre texte, et
// drawShader(1) est comparé à la version `develop` du fichier, récupérée par `git show`.
test('drawShader(k) opens exactly 6k slots for several k', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);
    const slots = slotCount(k);
    assert.match(shader, new RegExp(`entry>=uni\\.groupCount\\*${slots}u`));
    assert.match(shader, new RegExp(`slot<${slots}u`));
  }
});

test('drawShader(1) matches the develop shader: same slot count, same order, same bin/rest arithmetic', () => {
  const developSource = execSync('git show develop:packages/sdk-browser/gpuDrawShader.ts', {
    encoding: 'utf8',
    cwd: import.meta.dirname,
  });
  const literal = /`([^`]*)`/s.exec(developSource);
  assert.ok(literal, 'the develop file has one template-literal shader');
  const developShader = literal![1];
  const currentShader = drawShader(1);

  // Même nombre de slots (six) et mêmes trois passes, dans le même ordre : compte, préfixe, éparpille.
  const entryIndexes = (shader: string) =>
    ['fn countGroups', 'fn prefixGroups', 'fn scatterGroups'].map((needle) =>
      shader.indexOf(needle),
    );
  for (const shader of [developShader, currentShader]) {
    const indexes = entryIndexes(shader);
    assert.ok(
      indexes.every((index) => index >= 0),
      'les trois passes sont présentes',
    );
    assert.ok(
      indexes[0] < indexes[1] && indexes[1] < indexes[2],
      'comptage, préfixe puis éparpillage, dans cet ordre',
    );
    assert.match(shader, /entry>=uni\.groupCount\*6u/, 'six slots, comme avant');
  }

  // Même calcul de bin et de rest — la partie du slot qui porte la sémantique du tri, pas les noms
  // de champs ni les fonctions auxiliaires qui l'enveloppent. `develop` l'écrit en ligne dans
  // `matches` ; drawShader(1) l'isole dans `slotOf`, qui ajoute un terme de couche toujours nul
  // pour une seule couche (min(item.layer, 0u) == 0 quel que soit item.layer, car c'est un u32).
  assert.match(
    developShader,
    /fn matches\(i:u32,slot:u32\)->bool\{let item=items\[i\];return restAt\(i\)\*3u\+item\.bin==slot&&selected\(item\);\}/,
    'develop calcule le slot comme rest*3+bin',
  );
  const slotOfBody = /fn slotOf\([^)]*\)->u32\{return ([^;]+);\}/.exec(currentShader);
  assert.ok(slotOfBody, 'drawShader(1) calcule son slot par slotOf()');
  assert.equal(
    slotOfBody![1],
    'restAt(i)*3u+item.bin+6u*min(item.layer,0u)',
    'même terme rest*3+bin, plus un terme de couche dont la borne 0u le neutralise pour k=1',
  );
});
