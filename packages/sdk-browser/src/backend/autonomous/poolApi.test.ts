import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';

import { pageCopies } from './poolApi.ts';
import { createHeldFloor } from './heldFloor.ts';
import { createPageDraws } from './pageDraws.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/** A page geometry of `floats` position floats and three indices: `floats * 4 + 12` bytes. */
function pageGeometry(floats: number) {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(floats), 3));
  geometry.setIndex(new G.BufferAttribute(new Uint32Array(3), 1));
  return geometry as unknown as Geometry;
}

const rec = (url: string, extra: Partial<PageRec> = {}) =>
  ({ url, placementIndex: 0, ...extra }) as PageRec;
/** Rank 0 placed at its node, rank 1 by a row. */
const roots = [{}, { placement: {} }].map(
  (root) => ({ world: new G.Matrix4(), pages: [], ...root }) as ClusterRoot<PageRec>,
);
const world = { elements: new Float64Array(new G.Matrix4().toArray()) };

test('page copies follow the records that own a geometry, and the classic instances', () => {
  let instances = 0;
  const placed = { placementIndex: 1 };
  const byUrl = new Map([
    ['root', [rec('root')]],
    ['twice', [rec('twice'), rec('twice')]],
    ['rows', [rec('rows', placed), rec('rows', placed), rec('rows', placed)]],
  ]);
  // `twice` is replaced by the root's group: the floor holds it with the root (#1237).
  const copies = pageCopies(
    byUrl,
    (record) => !!roots[(record as { placementIndex?: number }).placementIndex ?? 0]?.placement,
    new Set(['root']),
    () => instances,
    new Set(['twice']),
  );
  assert.deepEqual(
    [copies.of('root'), copies.of('twice'), copies.of('rows'), copies.root(), copies.scene()],
    [1, 2, 1, 1, 4],
    'rows share one geometry',
  );
  assert.equal(copies.floor(), 3, 'the floor: the root and the pages its group replaces');
  instances = 2;
  assert.deepEqual(
    [copies.of('twice'), copies.of('rows'), copies.root(), copies.floor(), copies.scene()],
    [6, 1, 3, 9, 10],
    'each instance clones every owned geometry, the rows still share theirs',
  );
});

test('the floor counts the root cover and the replaced pages, read again only once changed', () => {
  const shared = pageGeometry(9),
    replaced = pageGeometry(30);
  const first = rec('root'),
    second = rec('root'),
    page = rec('page');
  const bootstrap = [first, second];
  const byUrl = new Map([['page', [page]]]);
  const root = { world, pages: [first, second, page] };
  const draws = createPageDraws([root]);
  draws.drawing(first).geometry = shared;
  draws.drawing(second).geometry = shared;
  draws.drawing(page).geometry = replaced;
  const modifiedPages = new Set<string>();
  const floor = createHeldFloor({ roots, bootstrap, modifiedPages, byUrl, draws });
  assert.equal(floor.bytes(), 9 * 4 + 12, 'a geometry two records share counts once');
  // A pose or a material announces nothing: nothing is walked.
  const extra = rec('root');
  bootstrap.push(extra);
  // The same root grown by a record: its instances carry their draw state (#1234, #1235).
  root.pages = [...bootstrap, page];
  draws.layOut([root]);
  draws.drawing(extra).geometry = pageGeometry(3);
  assert.equal(floor.bytes(), 9 * 4 + 12);
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12, 'every geometry counted afresh');
  modifiedPages.add('page');
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12 + 30 * 4 + 12);
  // The same page replaced again: the set of replaced pages keeps its size, the floor follows.
  draws.drawing(page).geometry = pageGeometry(60);
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12 + 60 * 4 + 12);
});

test('a replaced page moves the cover, not the placements the requests lay out', () => {
  const floor = createHeldFloor({
    roots,
    bootstrap: [],
    modifiedPages: new Set(),
    byUrl: new Map(),
    draws: createPageDraws([]),
  });
  const read = () => [floor.revision, floor.placements];
  floor.changed();
  assert.deepEqual(read(), [1, 0], 'prepare or a replaced page: the pool reads it, no layout');
  floor.placed();
  assert.deepEqual(read(), [2, 1], 'an instance or grown rows: both');
});

test('the floor counts every geometry the store counts: copies sharing their arrays included', () => {
  // Two records of one page, as the store builds them from one decoded page: two geometries on
  // the same arrays, each uploaded on its own; and an instance's clone of the first.
  const first = pageGeometry(9);
  const second = new G.Geometry();
  const source = first as unknown as G.Geometry;
  second.setIndex(new G.BufferAttribute(source.index!.array, 1));
  second.setAttribute('position', new G.BufferAttribute(source.attributes.position.array, 3));
  const clone = source.clone() as unknown as Geometry;
  const geometries = [first, second as unknown as Geometry, clone];
  const bootstrap = geometries.map(() => rec('root'));
  const draws = createPageDraws([{ world, pages: bootstrap }]);
  bootstrap.forEach((record, i) => (draws.drawing(record).geometry = geometries[i]));
  const floor = createHeldFloor({
    roots,
    bootstrap,
    modifiedPages: new Set(),
    byUrl: new Map(),
    draws,
  });
  assert.equal(floor.bytes(), 3 * (9 * 4 + 12), 'three geometries held, three copies counted');
});

/** The modules `entry` loads when it runs: its value imports, followed; a type import loads
 *  nothing. */
function loadedModules(entry: URL, into = new Set<string>()) {
  if (into.has(entry.pathname)) return into;
  into.add(entry.pathname);
  const source = readFileSync(entry, 'utf8');
  for (const [, type, from] of source.matchAll(
    /^(?:import|export) (type )?[^;]*? from '(\.[^']*)'/gm,
  )) {
    const target = new URL(from, entry);
    if (!type && existsSync(target)) loadedModules(target, into);
  }
  return into;
}

test('the WebGL2 path loads no code of the WebGPU engine, directly or through another module', () => {
  const directory = new URL('.', import.meta.url);
  for (const name of readdirSync(directory).filter((file) => !/\.(test|fixture)\./.test(file)))
    for (const loaded of loadedModules(new URL(name, directory)))
      assert.ok(
        !/\/src\/(webgpu|gpu)\//.test(loaded),
        `${name} loads ${loaded.slice(loaded.indexOf('/src/'))}`,
      );
});
