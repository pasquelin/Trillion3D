// #1232: the world roots are records read straight from their bytes (`worldRootsTable.ts`), as the
// cook writes them (`compiler_world_roots/records.rs`): every field back at its rank, a binary past
// 4 GiB named whole, and a file that breaks its contract refused whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../contracts/cache.ts';
import { worldRootsDag, worldRootsFixture } from './worldRoots.fixture.ts';
import { encodeWorldRoots, encodeWorldRootsDag } from './worldRootsRecords.fixture.ts';
import { readWorldRoots, readWorldRootsDag } from './worldRootsTable.ts';

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE';

test('the table reads every bundle, page, cell and object back at its record', () => {
  const { spec, bytes } = worldRootsFixture((page) => page[0].toString(16).padStart(64, 'a'));
  const table = readWorldRoots(bytes);
  const { pages, cells, ...head } = spec;
  const { pages: _pages, cells: _cells, ...read } = table;
  assert.deepEqual(read, head, 'its header, payload and bundles');
  assert.equal(table.pages.count, pages.length);
  assert.deepEqual(
    pages.map((_, at) => table.pages.at(at)),
    pages,
  );
  assert.equal(table.cells.count, cells.length);
  assert.deepEqual(
    cells.map((_, at) => table.cells.objects(at)),
    cells.map((c) => c.objects),
  );
  // Each object, by its rank, is found in its cell: an object root's `origin` names it (#1332).
  const ranks = cells.flatMap((cell, at) => cell.objects.map(() => at));
  assert.deepEqual(
    ranks.map((_, object) => table.cells.cellOf(object)),
    ranks,
  );
  // An unaligned view of the same bytes is read alike.
  const shifted = new Uint8Array(bytes.byteLength + 1);
  shifted.set(bytes, 1);
  assert.deepEqual(readWorldRoots(shifted.subarray(1)).cells.objects(1), cells[1].objects);
});

test('a binary past 4 GiB is named whole, its offsets in two words', () => {
  const { spec } = worldRootsFixture();
  const [first, second] = [3e9, 3e9];
  spec.bundles[0].bytes = spec.pinnedTopBytes = first;
  spec.bundles[1] = { ...spec.bundles[1], offset: first, bytes: second };
  spec.bundles[2].offset = first + second;
  const page = spec.bundles[2].bytes;
  spec.bundles[3].offset = first + second + page;
  spec.payload.bytes = first + second + 2 * page;
  const table = readWorldRoots(encodeWorldRoots(spec));
  assert.deepEqual(
    table.bundles.map((bundle) => bundle.offset),
    [0, first, first + second, first + second + page],
  );
  assert.equal(table.payload.bytes, first + second + 2 * page);
});

test('a table that breaks its contract is refused whole', () => {
  const broken: ((spec: ReturnType<typeof worldRootsFixture>['spec']) => void)[] = [
    (spec) => (spec.version = 1),
    (spec) => (spec.pinned = 0),
    (spec) => (spec.pinnedTopBytes += 1),
    (spec) => (spec.bundles[2].offset += 4),
    (spec) => (spec.payload.bytes -= 1),
    (spec) => spec.bundles[1].dependencies.push(9),
    (spec) => spec.cells[0].objects[0].dependencies.push(4),
  ];
  for (const [at, breaks] of broken.entries()) {
    const { spec } = worldRootsFixture();
    breaks(spec);
    assert.throws(() => readWorldRoots(encodeWorldRoots(spec)), refused, `breakage ${at}`);
  }
  const { bytes } = worldRootsFixture();
  assert.throws(() => readWorldRoots(bytes.subarray(0, bytes.byteLength - 4)), refused, 'cut');
  assert.throws(() => readWorldRoots(Uint8Array.from([...bytes, 0, 0, 0, 0])), refused, 'longer');
  const renamed = bytes.slice();
  renamed[3] = 0;
  assert.throws(() => readWorldRoots(renamed), refused, 'not a table');
});

test('the DAG reads every cluster and group back, in the cook’s rank', () => {
  const { clusters, groups } = worldRootsDag();
  const read = readWorldRootsDag(encodeWorldRootsDag({ clusters, groups }));
  assert.deepEqual(
    read.clusters,
    clusters.map(({ units: _, ...cluster }) => cluster),
  );
  assert.deepEqual(read.groups, groups);
  const outside = groups.map((g) => ({ ...g, children: [...g.children] }));
  outside[0].children.push(clusters.length);
  assert.throws(
    () => readWorldRootsDag(encodeWorldRootsDag({ clusters, groups: outside })),
    refused,
  );
  assert.throws(() => readWorldRootsDag(encodeWorldRootsDag({ clusters, groups }, 1)), refused);
});
