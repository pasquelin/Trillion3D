// Batch F, F12: `deplaceInstance` (instancePose.ts) places each root from its base root, and the
// meshes of its pages follow it (#1226: a page carries no pose; #1234: its draw state is a packed
// table), instead of rebuilding a page → base-page hash table on every move. The oracle is the
// reconstruction from before batch F, copied as-is into `oracles/cadre-vue.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousInstances } from './instances.ts';
import { deplaceInstance } from './instancePose.ts';
import { createPageDraws } from './pageDraws.ts';
import { asHostLibrary, type HostMaterial, type HostMesh } from '../../host/resources.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';
import type { Material } from '../../../../sdk-core/src/index.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import type { PageRec, ClusterRoot } from '../../page/selection/selection.ts';

/** The records carry the contract pose; the oracle and the assertions read a host matrix. */
const pose = (matrix: MatrixElements) => asHostLibrary<G.Matrix4>(matrix);
import { referenceUpdateInstance } from '../../../../../bench/oracles/browser/view-frame.ts';

/** A page, with the world the oracle reads on it: its root's. */
function page(matrice: G.Matrix4) {
  return { matrix: matrice } as unknown as PageRec & { matrix: G.Matrix4 };
}
function root(matrice: G.Matrix4): ClusterRoot<PageRec> {
  return { world: matrice, pages: [] } as unknown as ClusterRoot<PageRec>;
}

/** `n` pages over `roots` roots, page `i` placed by root `i % roots`. */
function instanceEtBase(n: number, roots: number) {
  const baseRoots = Array.from({ length: roots }, (_, i) =>
    root(new G.Matrix4().makeTranslation(i, i, 0)),
  );
  const instRoots = baseRoots.map((r) => root(pose(r.world).clone()));
  const basePages = Array.from({ length: n }, (_, i) =>
    page(pose(baseRoots[i % roots].world).clone()),
  );
  const pages = basePages.map((base, i) => {
    const rec = page(pose(base.matrix).clone());
    instRoots[i % roots].pages.push(rec);
    return rec;
  });
  return { basePages, baseRoots, pages, instRoots };
}

function memeResultat(transform: G.Matrix4, n: number, rootsCount: number, avecMesh = false) {
  const a = instanceEtBase(n, rootsCount);
  const b = instanceEtBase(n, rootsCount);
  const draws = createPageDraws(a.instRoots);
  if (avecMesh)
    for (let i = 0; i < n; i++) {
      draws.drawing(a.pages[i]).mesh = { matrix: new G.Matrix4() } as unknown as HostMesh;
      (b.pages[i] as { mesh?: { matrix: G.Matrix4 } }).mesh = { matrix: new G.Matrix4() };
    }
  // The contract carries sixteen floats; the frozen oracle keeps the host matrix it was written with.
  deplaceInstance({ roots: a.instRoots }, a.baseRoots, transform.elements.slice(), draws);
  referenceUpdateInstance(
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[0]>({
      pages: b.pages,
      roots: b.instRoots,
    }),
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[1]>(b.basePages),
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[2]>(b.baseRoots),
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[3]>(transform),
  );
  for (let i = 0; i < n; i++) {
    assert.deepEqual(
      pose(a.instRoots[i % rootsCount].world).toArray(),
      pose(b.pages[i].matrix).toArray(),
      `page ${i}`,
    );
    if (avecMesh)
      assert.deepEqual(
        (draws.find(a.pages[i])!.mesh as unknown as { matrix: G.Matrix4 }).matrix.toArray(),
        (b.pages[i] as { mesh?: { matrix: G.Matrix4 } }).mesh!.matrix.toArray(),
        `mesh ${i}`,
      );
  }
  for (let i = 0; i < rootsCount; i++)
    assert.deepEqual(
      pose(a.instRoots[i].world).toArray(),
      pose(b.instRoots[i].world).toArray(),
      `root ${i}`,
    );
}

test('no page and no root: nothing to move, neither side touches anything', () => {
  memeResultat(new G.Matrix4().makeTranslation(5, 5, 5), 0, 0);
});

test('a single page and a single root, identity transform', () => {
  memeResultat(new G.Matrix4(), 1, 1);
});

test('several pages and roots, composed transform (rotation + scale + translation)', () => {
  const transform = new G.Matrix4()
    .makeRotationY(Math.PI / 3)
    .multiply(new G.Matrix4().makeScale(2, 0.5, -1))
    .setPosition(3, -7, 11);
  memeResultat(transform, 8, 3);
});

test('a mesh attached to the page also receives the same matrix as the reference', () => {
  memeResultat(new G.Matrix4().makeTranslation(1, 2, 3), 4, 1, true);
});

test('a degenerate transform (zero scale) yields the same matrix on both sides', () => {
  memeResultat(new G.Matrix4().makeScale(0, 0, 0), 3, 2);
});

// Repainting a primitive replaces the pair the engine owns instead of stacking it: the host may
// call `updateMaterial` as often as it likes without the session growing by two materials a call.
const CONTRACT_MATERIAL: Material = {
  baseColor: [1, 0, 0],
  opacity: 1,
  metalness: 0,
  roughness: 1,
  emissive: [0, 0, 0],
  side: 'front',
  alphaMode: 'opaque',
  alphaCutoff: 0.5,
};

function primitivePeinte() {
  const plain = { url: 'p', clusterId: 'prim/0', attributes: {} } as unknown as PageRec;
  const coloured = {
    url: 'c',
    clusterId: 'prim/1',
    attributes: { color: {} },
  } as unknown as PageRec;
  const colorMaterials = new Map<HostMaterial, HostMaterial>();
  const draws = createPageDraws([
    { world: { elements: new Float64Array(new G.Matrix4().toArray()) }, pages: [plain, coloured] },
  ]);
  const instances = createAutonomousInstances({
    roots: [],
    baseRoots: [],
    allPages: [plain, coloured],
    basePages: [],
    bootstrap: [],
    baseBootstrap: [],
    byUrl: new Map(),
    draws,
    geometryStore: {
      colorMaterials,
    } as Parameters<typeof createAutonomousInstances>[0]['geometryStore'],
    hostCeiling: 0,
    overCeiling: () => false,
    sceneChanged: () => {},
    coverChanged: () => {},
    blendOf: () => false,
  });
  return { plain, coloured, colorMaterials, instances };
}

test('repainting a primitive frees the pair the previous paint owned', () => {
  const { plain, coloured, colorMaterials, instances } = primitivePeinte();
  instances.updateMaterial('prim', CONTRACT_MATERIAL);
  const first = [plain.declaration, coloured.declaration] as unknown as GraphSurface[];
  assert.notEqual(first[0], first[1], 'a colour attribute draws with its own twin');
  let disposed = 0;
  for (const material of first) material.released.add(() => disposed++);
  instances.updateMaterial('prim', { ...CONTRACT_MATERIAL, baseColor: [0, 1, 0] });
  assert.equal(disposed, 2, 'the plain material and its twin are freed at the replacement');
  assert.equal(colorMaterials.size, 1, 'the shared cache keeps one twin per live material');
  assert.equal(colorMaterials.get(plain.declaration as HostMaterial), coloured.declaration);
  instances.disposeOwnedMaterials();
  assert.equal(colorMaterials.size, 0, 'disposal frees the last paint and its twin');
});

// A primitive repainted, then given a created material (#847): the paint no record wears any more
// is freed at once, with its twin, not held until the session closes.
test('a created material assigned over a paint frees the pair the paint owned', () => {
  const { plain, coloured, colorMaterials, instances } = primitivePeinte();
  const source = {};
  for (const rec of [plain, coloured]) rec.sourceMesh = source as PageRec['sourceMesh'];
  instances.updateMaterial('prim', CONTRACT_MATERIAL);
  const paint = [plain.declaration, coloured.declaration] as unknown as GraphSurface[];
  let disposed = 0;
  for (const material of paint) material.released.add(() => disposed++);
  const created = new G.GraphSurface('standard');
  instances.wearSurface({
    surfaces: [created],
    meshes: new Map([[source, created]]),
    from: 'opaque',
    to: 'opaque',
  });
  assert.equal(plain.declaration, created as unknown as HostMaterial, 'the page wears it');
  const twin = coloured.declaration as unknown as GraphSurface;
  assert.equal(
    twin.vertexColors,
    true,
    'a page with colours keeps them in a plain created surface',
  );
  assert.equal(disposed, 2, 'the paint and its twin are freed as the page stops wearing them');
  assert.equal(colorMaterials.size, 1, "only the created material's twin is cached");
  instances.disposeOwnedMaterials();
  assert.equal(disposed, 2, 'nothing freed twice');
});
