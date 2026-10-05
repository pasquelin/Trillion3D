import test from 'node:test';
import assert from 'node:assert/strict';
import { deformationSlotBytes, writeRowDeformation, writeSpanDeformation } from './slotLayout.ts';
import { DEFORM_IN_POOL, DEFORM_NO_HEADER } from '../visibility/types.ts';
import type { DeformationOutput } from '../page/selection/types.ts';
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

test("a page's own home is raised to its last tail; every tail keeps its offset inside it", () => {
  const pages = () => [
    page('shared', 3),
    page('shared', 3),
    page('other', 4),
    page('plain', 5, false),
  ];
  const fixed = pages();
  deformationSlotBytes(fixed, 128);
  const placed = pages(),
    homes = new Map([
      ['shared', 40],
      ['other', 128],
      ['plain', 20],
    ]);
  assert.equal(deformationSlotBytes(placed, 128, [], homes), 128 + 2 * 3 * 11 * 4);
  assert.deepEqual(
    placed.map((rec) => rec.deformationOutput),
    fixed.map((rec) => rec.deformationOutput),
    'the same offsets as in a fixed slot',
  );
  assert.deepEqual(Object.fromEntries(homes), { shared: 392, other: 304, plain: 20 });
  for (const rec of placed) {
    const output = rec.deformationOutput;
    if (!output) continue;
    // Its two tags, then eleven words a vertex: past the widest page, inside the home.
    const from = output.from - 2,
      end = output.from + output.count * 11 - 2;
    assert.ok(from >= 128 / 4 && end * 4 <= homes.get(rec.url)!, rec.url);
  }
});

// The words the three old writers (a row's first write, the pool's follow, a span) put, as they put them.
test('a row and a span name an output by the words every old writer wrote', () => {
  const slot: DeformationOutput = { from: 34, count: 3 },
    pool = { from: 100, count: 7, pool: {} } as DeformationOutput,
    poolWord = ((101 | DEFORM_IN_POOL | DEFORM_NO_HEADER) >>> 0) as number;
  const ints = new Uint32Array(200),
    spans = new Uint32Array(8);
  const at = 3 * 16;
  const [count, out] = [65, 66];
  writeRowDeformation(ints, at, slot, 20);
  assert.deepEqual(
    [ints[at + count], ints[at + out]],
    [3, 20 + 34 + 1],
    'a slot: its count, its slot offset',
  );
  writeRowDeformation(ints, at, pool, 20);
  assert.deepEqual([ints[at + count], ints[at + out]], [0, poolWord], 'a pool block: no own count');
  writeRowDeformation(ints, at, undefined, 20);
  assert.deepEqual([ints[at + count], ints[at + out]], [0, 0], 'none');
  writeSpanDeformation(spans, 1, slot, 20, 6);
  assert.deepEqual([...spans.subarray(6, 8)], [55, 3]);
  writeSpanDeformation(spans, 1, pool, 0, 6);
  assert.deepEqual([...spans.subarray(6, 8)], [poolWord, 0]);
  writeSpanDeformation(spans, 1, slot, 20, 0);
  assert.deepEqual([...spans.subarray(6, 8)], [0, 0], 'a span that draws nothing names nothing');
});
