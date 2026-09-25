import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as G from '../../host/graph/graph.fixture.ts';
import type { PageRec } from '../../page/selection/selection.ts';

import { pageCopies } from './poolApi.ts';
import { createHeldFloor } from './heldFloor.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/** A page geometry of `floats` position floats and three indices: `floats * 4 + 12` bytes. */
function pageGeometry(floats: number) {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(floats), 3));
  geometry.setIndex(new G.BufferAttribute(new Uint32Array(3), 1));
  return geometry as unknown as Geometry;
}

const rec = (url: string, extra: Partial<PageRec> = {}) => ({ url, ...extra }) as PageRec;

test('page copies follow the records that own a geometry, and the classic instances', () => {
  let instances = 0;
  const placed = { placement: {} } as Partial<PageRec>;
  const byUrl = new Map([
    ['root', [rec('root')]],
    ['twice', [rec('twice'), rec('twice')]],
    ['rows', [rec('rows', placed), rec('rows', placed), rec('rows', placed)]],
  ]);
  const copies = pageCopies(byUrl, new Set(['root']), () => instances);
  assert.deepEqual(
    [copies.of('root'), copies.of('twice'), copies.of('rows'), copies.root(), copies.scene()],
    [1, 2, 1, 1, 4],
    'rows share one geometry',
  );
  instances = 2;
  assert.deepEqual(
    [copies.of('twice'), copies.of('rows'), copies.root(), copies.scene()],
    [6, 1, 3, 10],
    'each instance clones every owned geometry, the rows still share theirs',
  );
});

test('the floor counts the root cover and the replaced pages, read again only once changed', () => {
  const shared = pageGeometry(9),
    replaced = pageGeometry(30);
  const bootstrap = [rec('root', { geometry: shared }), rec('root', { geometry: shared })];
  const byUrl = new Map([['page', [rec('page', { geometry: replaced })]]]);
  const modifiedPages = new Set<string>();
  const floor = createHeldFloor({ bootstrap, modifiedPages, byUrl });
  assert.equal(floor.bytes(), 9 * 4 + 12, 'a geometry two records share counts once');
  // A pose or a material announces nothing: nothing is walked.
  bootstrap.push(rec('root', { geometry: pageGeometry(3) }));
  assert.equal(floor.bytes(), 9 * 4 + 12);
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12, 'every geometry counted afresh');
  modifiedPages.add('page');
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12 + 30 * 4 + 12);
  // The same page replaced again: the set of replaced pages keeps its size, the floor follows.
  byUrl.get('page')![0].geometry = pageGeometry(60);
  floor.changed();
  assert.equal(floor.bytes(), 9 * 4 + 12 + 3 * 4 + 12 + 60 * 4 + 12);
});

test('a replaced page moves the cover, not the placements the requests lay out', () => {
  const floor = createHeldFloor({ bootstrap: [], modifiedPages: new Set(), byUrl: new Map() });
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
  const bootstrap = [first, second as unknown as Geometry, clone].map((geometry) =>
    rec('root', { geometry }),
  );
  const floor = createHeldFloor({ bootstrap, modifiedPages: new Set(), byUrl: new Map() });
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
