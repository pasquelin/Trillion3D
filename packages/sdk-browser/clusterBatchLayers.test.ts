import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLayerGroups, groupForPage, everyGroup } from './clusterBatchLayers.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';
import type { BatchPage } from './clusterBatchRange.ts';
import { ClusterBatches } from './clusterBatches.ts';
import { attributes } from './clusterBatchesFixture.ts';
import { depthLayerUnits } from '../sdk-core/index.ts';

const page = (extra: Partial<BatchPage>): BatchPage => ({
  id: 0,
  url: 'u',
  triangles: 1,
  min: [0, 0, 0],
  max: [1, 1, 1],
  attributes: attributes(3),
  material: new THREE.MeshBasicMaterial(),
  matrix: new THREE.Matrix4(),
  renderOrder: 0,
  ...extra,
});

// Behaviour 18: buildLayerGroups creates one twin batch per (instance, layer) and none when the
// scene has no layer.
test('buildLayerGroups creates no twin batch when no page carries a coplanar layer', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const pages = [page({ renderOrder: 0, depthLayer: 0 }), page({ renderOrder: 0 })];
  const built = buildLayerGroups(pages, groups);
  assert.deepEqual(built.materials, []);
  assert.ok(built.layerGroups.every((entry) => entry === undefined));
});

test('buildLayerGroups creates one twin batch per (instance, layer)', () => {
  const groups: Array<BatchGroup | undefined> = [
    new BatchGroup({} as never),
    new BatchGroup({} as never),
  ];
  const pages = [
    page({ renderOrder: 0, depthLayer: 2, id: 0 }),
    page({ renderOrder: 0, depthLayer: 2, id: 1 }), // same (instance, layer): not a second twin
    page({ renderOrder: 0, depthLayer: 3, id: 2 }), // same instance, other layer: another twin
    page({ renderOrder: 1, depthLayer: 1, id: 3 }), // other instance
  ];
  const built = buildLayerGroups(pages, groups);
  assert.equal(built.layerGroups[0]!.size, 2, 'two distinct layers on the first instance');
  assert.equal(built.layerGroups[1]!.size, 1);
  assert.equal(built.materials.length, 3, 'one biased material per twin batch created');
});

// Behaviour 20: biasedMaterial (tested via buildLayerGroups) sets polygonOffset, a zero factor
// and units equal to the layer bias.
test('the twin batch material carries polygonOffset with the layer bias in its units', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const pages = [page({ renderOrder: 0, depthLayer: 4 })];
  const built = buildLayerGroups(pages, groups);
  const biased = built.layerGroups[0]!.get(4)!.biased as THREE.MeshBasicMaterial;
  assert.equal(biased.polygonOffset, true);
  assert.equal(biased.polygonOffsetFactor, 0);
  // WebGL2 path, forward depth: the offset toward the eye is NEGATIVE.
  assert.equal(biased.polygonOffsetUnits, -depthLayerUnits(4));
  assert.notEqual(biased, pages[0].material, 'the biased material is a clone, not the original');
});

test('a coplanar double-sided blend keeps biased back then front passes', () => {
  const base = new BatchGroup({} as never),
    source = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    back = source.clone(),
    front = source.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  base.split = [back, front];
  const built = buildLayerGroups([page({ material: source, depthLayer: 2 })], [base]);
  const biased = built.layerGroups[0]!.get(2)!.biased;
  assert.ok(Array.isArray(biased));
  assert.deepEqual(
    biased.map((material) => material.side),
    [THREE.BackSide, THREE.FrontSide],
  );
  assert.ok(biased.every((material) => material.polygonOffsetUnits === -depthLayerUnits(2)));
});

// Behaviour 19: groupForPage routes a marked page to its biased batch, a layer-0 page
// to the original batch.
test('groupForPage routes a layered page to its twin and a layer-0 page to the original group', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const layered = page({ renderOrder: 0, depthLayer: 5 });
  const untouched = page({ renderOrder: 0, depthLayer: 0 });
  const built = buildLayerGroups([layered], groups);
  assert.equal(groupForPage(groups, built.layerGroups, layered), built.layerGroups[0]!.get(5));
  assert.equal(groupForPage(groups, built.layerGroups, untouched), groups[0]);
});

// Behaviour 21: everyGroup walks the layer-0 batches and their twins; dispose frees the
// biased materials.
test('everyGroup walks the layer-0 groups and every one of their twins', () => {
  const base0 = new BatchGroup({} as never),
    base1 = new BatchGroup({} as never);
  const twinA = new BatchGroup({} as never),
    twinB = new BatchGroup({} as never);
  const groups: Array<BatchGroup | undefined> = [base0, undefined, base1];
  const layerGroups: Array<Map<number, BatchGroup> | undefined> = [
    new Map([[1, twinA]]),
    undefined,
    new Map([
      [1, twinB],
      [2, twinB],
    ]),
  ];
  const walked = [...everyGroup(groups, layerGroups)];
  assert.deepEqual(new Set(walked), new Set([base0, base1, twinA, twinB]));
});

test('ClusterBatches.dispose releases the biased materials it created for layered clusters', () => {
  const scene = new THREE.Scene();
  const original = new THREE.MeshBasicMaterial();
  const shared = attributes(6);
  const pages: BatchPage[] = [
    page({
      renderOrder: 0,
      depthLayer: 0,
      id: 0,
      url: 'a',
      attributes: shared,
      material: original,
    }),
    page({
      renderOrder: 0,
      depthLayer: 3,
      id: 1,
      url: 'b',
      attributes: shared,
      material: original,
    }),
  ];
  const batches = new ClusterBatches(scene, pages);
  for (const rec of pages) {
    const array = Uint32Array.from([0, 1, 2]);
    rec.array = array;
    batches.acceptPage([rec], array);
  }
  batches.update(pages);
  const biasedMesh = scene.children.find((child) => (child as THREE.Mesh).material !== original) as
    THREE.Mesh | undefined;
  assert.ok(biasedMesh, 'the layered cluster draws through a distinct, biased material');
  const biased = biasedMesh!.material as THREE.Material;
  let disposed = 0;
  biased.addEventListener('dispose', () => disposed++);
  batches.dispose();
  assert.equal(disposed, 1, 'dispose() released the biased material exactly once');
  assert.equal(scene.children.length, 0);
});
