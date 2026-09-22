// Batch F, F12: `deplaceInstance` (autonomousInstances.ts) reads the page/base-page pair set
// once at creation (`instance.pages[i]` / `instance.bases[i]`) instead of rebuilding a
// page → base-page hash table on every move. The oracle is the reconstruction from before
// batch F, copied as-is into `oracles/cadre-vue.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAutonomousInstances, deplaceInstance } from './autonomousInstances.ts';
import { asHostLibrary } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { Material } from '../sdk-core/index.ts';

/** The records carry the contract pose; the oracle and the assertions read a host matrix. */
const pose = (matrix: MatrixElements) => asHostLibrary<THREE.Matrix4>(matrix);
import { referenceUpdateInstance } from './bench/oracles/cadre-vue.ts';
import type { PageRec, ClusterRoot } from './pageSelection.ts';

function page(matrice: THREE.Matrix4): PageRec {
  return { matrix: matrice, mesh: undefined } as unknown as PageRec;
}
function root(matrice: THREE.Matrix4): ClusterRoot<PageRec> {
  return { world: matrice, pages: [] } as unknown as ClusterRoot<PageRec>;
}

function instanceEtBase(n: number, roots: number) {
  const basePages = Array.from({ length: n }, (_, i) =>
    page(new THREE.Matrix4().makeTranslation(i, 0, 0)),
  );
  const baseRoots = Array.from({ length: roots }, (_, i) =>
    root(new THREE.Matrix4().makeTranslation(0, i, 0)),
  );
  const pages = basePages.map((base) => page(pose(base.matrix).clone()));
  const instRoots = baseRoots.map((r) => root(pose(r.world).clone()));
  return { basePages, baseRoots, pages, instRoots };
}

function memeResultat(transform: THREE.Matrix4, n: number, rootsCount: number, avecMesh = false) {
  const a = instanceEtBase(n, rootsCount);
  const b = instanceEtBase(n, rootsCount);
  if (avecMesh)
    for (let i = 0; i < n; i++) {
      a.pages[i].mesh = { matrix: new THREE.Matrix4() } as unknown as PageRec['mesh'];
      b.pages[i].mesh = { matrix: new THREE.Matrix4() } as unknown as PageRec['mesh'];
    }
  // The contract carries sixteen floats; the frozen oracle keeps the host matrix it was written with.
  deplaceInstance(
    { pages: a.pages, bases: a.basePages, roots: a.instRoots },
    a.baseRoots,
    transform.toArray(new Float64Array(16)),
  );
  referenceUpdateInstance(
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[0]>({
      pages: b.pages,
      roots: b.instRoots,
    }),
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[1]>(b.basePages),
    asHostLibrary<Parameters<typeof referenceUpdateInstance>[2]>(b.baseRoots),
    transform,
  );
  for (let i = 0; i < n; i++) {
    assert.deepEqual(
      pose(a.pages[i].matrix).toArray(),
      pose(b.pages[i].matrix).toArray(),
      `page ${i}`,
    );
    if (avecMesh)
      assert.deepEqual(
        (a.pages[i].mesh as unknown as { matrix: THREE.Matrix4 }).matrix.toArray(),
        (b.pages[i].mesh as unknown as { matrix: THREE.Matrix4 }).matrix.toArray(),
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
  memeResultat(new THREE.Matrix4().makeTranslation(5, 5, 5), 0, 0);
});

test('a single page and a single root, identity transform', () => {
  memeResultat(new THREE.Matrix4(), 1, 1);
});

test('several pages and roots, composed transform (rotation + scale + translation)', () => {
  const transform = new THREE.Matrix4()
    .makeRotationY(Math.PI / 3)
    .scale(new THREE.Vector3(2, 0.5, -1))
    .setPosition(3, -7, 11);
  memeResultat(transform, 8, 3);
});

test('a mesh attached to the page also receives the same matrix as the reference', () => {
  memeResultat(new THREE.Matrix4().makeTranslation(1, 2, 3), 4, 1, true);
});

test('a degenerate transform (zero scale) yields the same matrix on both sides', () => {
  const transform = new THREE.Matrix4().makeScale(0, 0, 0);
  memeResultat(transform, 3, 2);
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
  const plain = { clusterId: 'prim/0', attributes: {} } as unknown as PageRec;
  const coloured = { clusterId: 'prim/1', attributes: { color: {} } } as unknown as PageRec;
  const colorMaterials = new Map<THREE.Material, THREE.Material>();
  const instances = createAutonomousInstances({
    roots: [],
    baseRoots: [],
    allPages: [plain, coloured],
    basePages: [],
    bootstrap: [],
    baseBootstrap: [],
    byUrl: new Map(),
    baseMaterials: new Map(),
    geometryStore: {
      colorMaterials,
    } as Parameters<typeof createAutonomousInstances>[0]['geometryStore'],
    cap: 0,
    sceneChanged: () => {},
  });
  return { plain, coloured, colorMaterials, instances };
}

test('repainting a primitive frees the pair the previous paint owned', () => {
  const { plain, coloured, colorMaterials, instances } = primitivePeinte();
  instances.updateMaterial('prim', CONTRACT_MATERIAL);
  const first = [plain.declaration, coloured.declaration] as THREE.Material[];
  assert.notEqual(first[0], first[1], 'a colour attribute draws with its own twin');
  let disposed = 0;
  for (const material of first) material.addEventListener('dispose', () => disposed++);
  instances.updateMaterial('prim', { ...CONTRACT_MATERIAL, baseColor: [0, 1, 0] });
  assert.equal(disposed, 2, 'the plain material and its twin are freed at the replacement');
  assert.equal(colorMaterials.size, 1, 'the shared cache keeps one twin per live material');
  assert.equal(colorMaterials.get(plain.declaration as THREE.Material), coloured.declaration);
  instances.disposeOwnedMaterials();
  assert.equal(colorMaterials.size, 0, 'disposal frees the last paint and its twin');
});
