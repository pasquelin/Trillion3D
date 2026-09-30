import type { Scene } from '../../world/core/scene.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousInstances } from './instances.ts';
import { createAutonomousGeometry } from './geometry.ts';
import { rootOf, type ClusterRoot, type PageRec } from '../../page/selection/selection.ts';
import { createPageDraws } from './pageDraws.ts';

// An instance copies the geometry of every record the model owns, and shares the one rows place,
// as the store gives it (`geometry.ts`): moving or removing an instance leaves the model and the
// other instances as they are. #1234: the draw state is keyed by packed index, in `PageDraws`.
test('an instance changed or removed leaves the model and the other instances as they are', () => {
  const geometryOf = () => {
    const geometry = new G.Geometry();
    geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(9), 3));
    geometry.setIndex(new G.BufferAttribute(new Uint32Array(3), 1));
    return geometry;
  };
  // Each record the page of a root of its own, at the identity; the second root placed by a row.
  const roots: ClusterRoot<PageRec>[] = [];
  const record = (clusterId: string, placement?: object) => {
    const rec = {
      url: 'p.bin',
      clusterId,
      placementIndex: roots.length,
      array: new Uint32Array(3),
    } as unknown as PageRec;
    const world = { elements: new Float64Array(new G.Matrix4().toArray()) };
    roots.push({ world, pages: [rec], placement } as ClusterRoot<PageRec>);
    return rec;
  };
  const own = record('prim/0'),
    rowed = record('prim/1', {});
  const draws = createPageDraws(roots);
  draws.drawing(own).geometry = geometryOf();
  draws.drawing(rowed).geometry = geometryOf();
  const worldOf = (rec: PageRec) => Array.from(rootOf(roots, rec).world.elements);
  const bytes = (geometry: unknown) =>
    (geometry as G.Geometry).index!.array.byteLength +
    (geometry as G.Geometry).attributes.position.array.byteLength;
  const allPages = [own, rowed],
    byUrl = new Map([['p.bin', [own, rowed]]]);
  const geometryStore = createAutonomousGeometry({
    scene: { add: () => {}, remove: () => {} } as unknown as Scene,
    roots,
    allPages,
    bootstrap: [],
    views: { live: { shown: [] }, lists: () => [] },
    byUrl,
    descriptors: new Map(),
    draws,
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  });
  const { state } = geometryStore;
  state.allocationBytes = bytes(draws.geometryOf(own)) + bytes(draws.geometryOf(rowed));
  const instances = createAutonomousInstances({
    roots,
    baseRoots: roots.slice(),
    allPages,
    basePages: [own, rowed],
    bootstrap: [],
    baseBootstrap: [],
    byUrl,
    draws,
    geometryStore,
    hostCeiling: 10,
    overCeiling: () => false,
    sceneChanged: () => {},
    coverChanged: () => {},
    blendOf: () => false,
  });
  const before = state.allocationBytes;
  instances.addInstance('a', new G.Matrix4().elements.slice());
  instances.addInstance('b', new G.Matrix4().elements.slice());
  const [, , aOwn, aRowed, bOwn, bRowed] = byUrl.get('p.bin')!;
  assert.notEqual(draws.geometryOf(aOwn), draws.geometryOf(own), 'an owned geometry is copied');
  assert.notEqual(draws.geometryOf(aOwn), draws.geometryOf(bOwn));
  assert.equal(draws.geometryOf(aRowed), draws.geometryOf(rowed), 'rows share the page geometry');
  assert.equal(draws.geometryOf(bRowed), draws.geometryOf(rowed));
  assert.equal(
    state.allocationBytes,
    before + 2 * bytes(draws.geometryOf(own)),
    'one copy an instance',
  );
  // Moving `a` moves its own records only.
  const still = [own, rowed, bOwn, bRowed].map(worldOf);
  instances.updateInstance('a', new G.Matrix4().makeTranslation(4, 0, 0).elements.slice());
  assert.equal(worldOf(aOwn)[12], 4);
  assert.equal(worldOf(aRowed)[12], 4);
  assert.deepEqual([own, rowed, bOwn, bRowed].map(worldOf), still, 'the model and `b` do not move');
  // Removing `a` gives back its copy and nothing the model or `b` draws.
  let disposed = 0;
  for (const rec of [own, rowed, bOwn])
    (draws.geometryOf(rec) as unknown as G.Geometry).released.add(() => disposed++);
  instances.removeInstance('a');
  assert.deepEqual(byUrl.get('p.bin'), [own, rowed, bOwn, bRowed]);
  assert.equal(disposed, 0, 'no geometry of the model or of `b` is freed');
  assert.equal(state.allocationBytes, before + bytes(draws.geometryOf(own)));
  assert.ok(draws.geometryOf(bOwn) && draws.geometryOf(bRowed) === draws.geometryOf(rowed));
});

// An instance of a large world copies its roots and bootstrap pages one by one: a spread of that
// many arguments overflows the stack (#404, the crash `pages.ts` had).
test('an instance of a world with 300,000 roots and bootstrap pages is added whole', () => {
  const count = 300_000;
  const identity = { elements: new Float64Array(new G.Matrix4().toArray()) };
  const basePages = Array.from(
    { length: count },
    (_, i) => ({ url: 'p.bin', clusterId: `m/${i}`, placementIndex: i }) as unknown as PageRec,
  );
  const baseRoots = basePages.map((page) => ({ world: identity, pages: [page] }));
  const roots: typeof baseRoots = [],
    bootstrap: PageRec[] = [],
    draws = createPageDraws(baseRoots as ClusterRoot<PageRec>[]);
  const instances = createAutonomousInstances({
    roots: roots as never,
    baseRoots: baseRoots as never,
    allPages: [],
    basePages,
    bootstrap,
    baseBootstrap: basePages,
    byUrl: new Map(),
    draws,
    geometryStore: {} as Parameters<typeof createAutonomousInstances>[0]['geometryStore'],
    hostCeiling: Infinity,
    overCeiling: () => false,
    sceneChanged: () => {},
    coverChanged: () => {},
    blendOf: () => false,
  });
  instances.addInstance('a', new G.Matrix4().elements.slice());
  assert.equal(roots.length, count);
  assert.equal(bootstrap.length, count);
  assert.equal(bootstrap[count - 1].clusterId, `a/m/${count - 1}`);
});
