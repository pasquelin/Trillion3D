import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ClusterManifest } from '../sdk-core/index.ts';
import { collectClusterPages } from './pageSelection.ts';
import { createPageRowWriter } from './webgpuPageRow.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE, isTransmissive } from './visibilityBuffer.ts';
import {
  CLASS_DOUBLE,
  CLASS_MASK,
  CLASS_UV,
  CLASS_VERTEX_NORMAL,
  ROW_MATERIAL_CLASS_WORD,
} from './visibilityMaterialClass.ts';
import { sceneMaterialClasses } from './webgpuPageRowMaterial.ts';
import { markPresentClasses } from './webgpuMaterialPasses.ts';

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
  const source = new THREE.Group(),
    meshes: THREE.Mesh[] = [],
    associations = new Map<THREE.Object3D, { meshes: number; primitives: number }>();
  const materials = [
    // A cut-out: alphaMode MASK carries an alpha test and is not blended.
    new THREE.MeshStandardMaterial({ alphaTest: 0.5, side: THREE.DoubleSide }),
    // A blend: alphaMode BLEND.
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 }),
    // Transmission: thick glass or water, which reads what is already drawn behind it.
    Object.assign(new THREE.MeshPhysicalMaterial({ transparent: true }), { transmission: 1 }),
  ];
  const passes = ['exact-clusters', 'clustered-blend', 'shared-blend'];
  const primitives = materials.map((material, index) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3),
    );
    geometry.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geometry, material);
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
    errorModel: 'dag-group-qem-v1',
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
  writeRow(mask, 0, 0, 0, new Uint32Array([0, 1, 2]), floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, true, 'the cut-out flag is set');
  assert.equal(floats[19], 0.5, 'the material alpha threshold travels with the row');
  // A blend never becomes a cut-out: its row would otherwise discard instead of blending.
  const blend = Object.assign(collected.roots[1].pages[0], { placementIndex: 1 });
  writeRow(blend, 0, 0, 0, new Uint32Array([0, 1, 2]), floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, false);
  assert.equal(floats[19], 1);
});

test('a row carries its resolve class, the census of the scene knows it before any image', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const geometryBlocks = new Map(
    collected.roots.map((root) => [
      root.pages[0].attributes,
      { vertexBase: 0, count: 3, hasUv: false, hasNormal: true, hasTangent: false },
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
  writeRow(mask, 0, 0, 0, new Uint32Array([0, 1, 2]), floats, ints);
  writeRow(blend, 1, 1, 0, new Uint32Array([0, 1, 2]), floats, ints);
  const cutout = CLASS_MASK | CLASS_VERTEX_NORMAL | CLASS_DOUBLE;
  assert.equal(ints[ROW_MATERIAL_CLASS_WORD], cutout, 'double-sided cut-out with vertex normals');
  assert.equal(ints[stride + ROW_MATERIAL_CLASS_WORD], CLASS_VERTEX_NORMAL, 'the plain blend');
  assert.equal(cutout & CLASS_UV, 0, 'no uv block, no uv class bit');
  // The census reads the same fields the rows will carry: the two classes, sorted, once each.
  assert.deepEqual(sceneMaterialClasses(collected.allPages, geometryBlocks, layers), [
    CLASS_VERTEX_NORMAL,
    cutout,
  ]);
  // An image draws the classes of its packed rows only: the second row alone leaves the cut-out out.
  const stamps = new Uint32Array(2048);
  assert.equal(markPresentClasses(ints, 2, 7, stamps), 2);
  assert.equal(markPresentClasses(ints.subarray(stride), 1, 8, stamps), 1);
  assert.equal(stamps[CLASS_VERTEX_NORMAL], 8);
  assert.equal(stamps[cutout], 7);
});
