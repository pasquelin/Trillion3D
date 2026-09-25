import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { createPageRowWriter } from '../row/pageRow.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE, isTransmissive } from '../../visibility/buffer.ts';
import { CLASS_FEATURE } from '../../visibility/shader/materialClass.ts';
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts';
import { sceneMaterialClasses } from '../row/pageRowMaterial.ts';
import { createPresentClasses, markPresentClasses } from './materialPasses.ts';

const page = (id: number, url: string, start: number) => ({
  id,
  url,
  count: 3,
  bytes: 12,
  sha256: url,
  min: [-1, -1, 0],
  max: [1, 1, 0],
  role: 'exact' as const,
  start,
  level: 0,
  lodError: 0,
  sphere: [0, 0, 0, 1.5],
  parentError: null,
  parentSphere: null,
  group: null,
  source: null,
});

/** Three primitives, one per material class, the way the compiler classifies them. */
function scene() {
  const source = new G.Group(),
    meshes: G.GraphMesh[] = [],
    associations = new Map<G.Object3D, { meshes: number; primitives: number }>();
  const materials = [
    // A cut-out: alphaMode MASK carries an alpha test and is not blended.
    G.standardSurface({ alphaTest: 0.5, side: G.DOUBLE_SIDE }),
    // A blend: alphaMode BLEND.
    G.standardSurface({ transparent: true, opacity: 0.4 }),
    // Transmission: thick glass or water, which reads what is already drawn behind it.
    Object.assign(G.physicalSurface({ transparent: true }), { transmission: 1 }),
  ];
  const passes = ['exact-clusters', 'clustered-blend', 'shared-blend'];
  const primitives = materials.map((material, index) => {
    const geometry = new G.Geometry();
    geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
    geometry.setIndex(G.indices([0, 1, 2]));
    const mesh = G.mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    source.add(mesh);
    meshes.push(mesh);
    associations.set(mesh, { meshes: index, primitives: 0 });
    return {
      mesh: index,
      primitive: 0,
      pass: passes[index],
      clusterStrategy: 'dag-groups' as const,
      pages: [page(0, `p${index}`, 0)],
      structure: { version: 1, roots: [0], groups: [] },
    };
  });
  source.updateMatrixWorld(true);
  const metadata = {
    errorModel: 'dag-group-qem-v2',
    clusterStrategy: 'dag-groups',
    primitives,
  } as unknown as ClusterManifest;
  const indices = new Map(
    primitives.map((_, index) => [`p${index}`, new Uint32Array([0, 1, 2])] as const),
  );
  return { source, meshes, metadata, indices, associations };
}

test('the three material classes take the three paths the engine has for them', () => {
  const { source, meshes, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  // Cut-out and blend both become cluster roots, so both are cut by the GPU selection; only the
  // blend is drawn by the transparent pass. Transmission leaves the DAG as one mesh.
  assert.deepEqual(
    collected.roots.map((root) => root.pages[0].transparent),
    [false, true],
  );
  assert.equal(collected.roots[0].pages[0].sourceMesh, meshes[0], 'the cut-out stays opaque');
  assert.equal(collected.blendCopies.length, 1, 'only transmission leaves the DAG');
  assert.equal(collected.blendCopies[0].userData.sourceMesh, meshes[2]);
  assert.equal(isTransmissive(meshes[2].material), true);
  assert.equal(isTransmissive(meshes[1].material), false, 'a plain blend does not transmit');
});

test('a cut-out cluster carries its alpha test into the visibility row', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const floats = new Float32Array(PAGE_INFO_STRIDE / 4),
    ints = new Uint32Array(floats.buffer);
  const writeRow = createPageRowWriter({
    geometryBlocks: new Map(),
    mapLayer: new Map(),
    dataLayer: new Map(),
    markRowDirty: () => {},
  });
  // A page written as a row belongs to a placement: the WebGPU layout sets it.
  const mask = Object.assign(collected.roots[0].pages[0], { placementIndex: 0 });
  writeRow(mask, 0, 0, 0, floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, true, 'the cut-out flag is set');
  assert.equal(floats[19], 0.5, 'the material alpha threshold travels with the row');
  // A blend never becomes a cut-out: its row would otherwise discard instead of blending.
  const blend = Object.assign(collected.roots[1].pages[0], { placementIndex: 1 });
  writeRow(blend, 0, 0, 0, floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, false);
  assert.equal(floats[19], 1);
});

test('a row carries its resolve class, the census of the scene knows it before any image', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const geometryBlocks = new Map(
    collected.roots.map((root) => [
      root.pages[0].attributes,
      {
        vertexBase: 0,
        count: 3,
        hasUv: false,
        hasNormal: true,
        hasTangent: false,
        hasColor: false,
      },
    ]),
  );
  const layers = { mapLayer: new Map(), dataLayer: new Map() };
  const writeRow = createPageRowWriter({ geometryBlocks, ...layers, markRowDirty: () => {} });
  const floats = new Float32Array(PAGE_INFO_STRIDE / 2),
    ints = new Uint32Array(floats.buffer),
    stride = PAGE_INFO_STRIDE / 4;
  const [mask, blend] = collected.roots.map((root, index) =>
    Object.assign(root.pages[0], { placementIndex: index }),
  );
  writeRow(mask, 0, 0, 0, floats, ints);
  writeRow(blend, 1, 1, 0, floats, ints);
  const { HAS_MASK, HAS_VERTEX_NORMAL, DOUBLE_SIDED, HAS_UV } = CLASS_FEATURE;
  const cutout = HAS_MASK | HAS_VERTEX_NORMAL | DOUBLE_SIDED;
  assert.equal(ints[ROW_MATERIAL_CLASS_WORD], cutout, 'double-sided cut-out with vertex normals');
  assert.equal(ints[stride + ROW_MATERIAL_CLASS_WORD], HAS_VERTEX_NORMAL, 'the plain blend');
  assert.equal(cutout & HAS_UV, 0, 'no uv block, no uv class bit');
  // The census reads the same fields the rows will carry, for the pages that take a row: the
  // blend is a transparent page and the transmission left the DAG, so the cut-out's class alone
  // is compiled at preparation.
  assert.deepEqual(sceneMaterialClasses(collected.allPages, geometryBlocks, layers), [cutout]);
  // An image draws the classes of its packed rows only: the second row alone leaves the cut-out out.
  const present = createPresentClasses();
  assert.deepEqual(markPresentClasses(ints, 2, present), [cutout, HAS_VERTEX_NORMAL]);
  assert.deepEqual(markPresentClasses(ints.subarray(stride), 1, present), [HAS_VERTEX_NORMAL]);
});
