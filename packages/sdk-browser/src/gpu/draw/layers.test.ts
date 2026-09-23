import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  evaluateDrawCompact,
  slotCount,
  type DrawItem,
} from './draw.ts';
import { drawShader } from './shader.ts';
import { PRE_LAYERS_GPU_DRAW_SHADER_SOURCE } from '../../../../../tests/fixtures/gpuDrawShaderPreLayers.ts';

// Behaviour 16: a layer-n item goes to slot bin + 3·rest + 6·n, and layerSlots = 1
// (a scene with no stacked coplanar layer) reproduces exactly the six slots from before.
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
  // The three items, of different layers, all land in the same slot bin+3*rest.
  assert.equal(result.counts[BIN_BACK], 3);
  assert.deepEqual([...result.instances], [0, 1, 2]);
});

// Behaviour 17: drawShader(k) opens exactly 6k slots in its own text, and drawShader(1) is
// compared to the pre-batch version, frozen in `tests/fixtures/gpuDrawShaderPreLayers.ts` (the
// text of commit 5ae3b83, the last to have touched this file before layers). A versioned fixture
// rather than `git show` on that commit: once the batch is merged, `develop` would carry the
// after version and a `git show` on the branch would compare to itself.
test('drawShader(k) opens exactly 6k slots for several k', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);
    const slots = slotCount(k);
    assert.match(shader, new RegExp(`entry>=uni\\.groupCount\\*${slots}u`));
    assert.match(shader, new RegExp(`slot<${slots}u`));
  }
});

test('drawShader(1) matches the pre-layer shader: same slot count, same order, same bin/rest arithmetic', () => {
  const developShader = PRE_LAYERS_GPU_DRAW_SHADER_SOURCE;
  const currentShader = drawShader(1);

  // Same slot count (six) and same three passes, in the same order: count, prefix, scatter.
  const entryIndexes = (shader: string) =>
    ['fn countGroups', 'fn prefixGroups', 'fn scatterGroups'].map((needle) =>
      shader.indexOf(needle),
    );
  for (const shader of [developShader, currentShader]) {
    const indexes = entryIndexes(shader);
    assert.ok(
      indexes.every((index) => index >= 0),
      'the three passes are present',
    );
    assert.ok(
      indexes[0] < indexes[1] && indexes[1] < indexes[2],
      'count, prefix then scatter, in that order',
    );
    assert.match(shader, /entry>=uni\.groupCount\*6u/, 'six slots, as before');
  }

  // Same bin and rest arithmetic — the part of the slot that carries the sort semantics, not
  // field names nor the helper functions that wrap it. `develop` writes it inline in `matches`;
  // drawShader(1) isolates it in `slotOf`, which adds a layer term that is always zero for a
  // single layer (min(item.layer, 0u) == 0 whatever item.layer, because it is a u32).
  assert.match(
    developShader,
    /fn matches\(i:u32,slot:u32\)->bool\{let item=items\[i\];return restAt\(i\)\*3u\+item\.bin==slot&&selected\(item\);\}/,
    'the pre-batch version computes the slot as rest*3+bin',
  );
  const slotOfBody = /fn slotOf\([^)]*\)->u32\{return ([^;]+);\}/.exec(currentShader);
  assert.ok(slotOfBody, 'drawShader(1) computes its slot via slotOf()');
  assert.equal(
    slotOfBody![1],
    'restAt(i)*3u+item.bin+6u*min(item.layer,0u)',
    'same rest*3+bin term, plus a layer term whose 0u bound cancels it for k=1',
  );
});
