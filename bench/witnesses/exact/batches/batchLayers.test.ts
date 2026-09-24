import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLayerGroups, groupForPage, everyGroup } from './batchLayers.ts';
import { BatchGroup } from './batchPrimitive.ts';
import type { BatchPage } from '../../../../packages/sdk-browser/src/cluster/batchRange.ts';
import { ClusterBatches } from './batches.ts';
import type { ClusterDrawMesh } from '../../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import { attributes } from './batches.fixture.ts';
import { depthLayerUnits } from '../../../../packages/sdk-core/src/index.ts';
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts';

const BASE_MATERIAL = new THREE.MeshBasicMaterial();
const page = (extra: Partial<BatchPage>): BatchPage => ({
  id: 0,
  url: 'u',
  triangles: 1,
  min: [0, 0, 0],
  max: [1, 1, 1],
  attributes: attributes(3),
  material: surfaceOf(BASE_MATERIAL),
  declaration: BASE_MATERIAL,
  matrix: new THREE.Matrix4(),
  renderOrder: 0,
  ...extra,
});

// Behaviour 18: buildLayerGroups creates one twin batch per (instance, layer) and none when the
// scene has no layer.
test('buildLayerGroups creates no twin batch when no page carries a coplanar layer', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const pages = [page({ renderOrder: 0, depthLayer: 0 }), page({ renderOrder: 0 })];
  const layerGroups = buildLayerGroups(pages, groups);
  assert.ok(layerGroups.every((entry) => entry === undefined));
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
  const layerGroups = buildLayerGroups(pages, groups);
  assert.equal(layerGroups[0]!.size, 2, 'two distinct layers on the first instance');
  assert.equal(layerGroups[1]!.size, 1);
});

// Behaviour 20: the twin batch carries the layer bias in hardware units, on its own record —
// no host material is cloned for it.
test('the twin batch carries the layer bias in its units and draws the source material', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const pages = [page({ renderOrder: 0, depthLayer: 4 })];
  const twin = buildLayerGroups(pages, groups)[0]!.get(4)!;
  // WebGL2 path, forward depth: the offset toward the eye is NEGATIVE.
  assert.equal(twin.polygonOffsetUnits, -depthLayerUnits(4));
  assert.equal(groups[0]!.polygonOffsetUnits, undefined, 'the layer-0 batch keeps its own');
});

// Behaviour 19: groupForPage routes a marked page to its biased batch, a layer-0 page
// to the original batch.
test('groupForPage routes a layered page to its twin and a layer-0 page to the original group', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const layered = page({ renderOrder: 0, depthLayer: 5 });
  const untouched = page({ renderOrder: 0, depthLayer: 0 });
  const layerGroups = buildLayerGroups([layered], groups);
  assert.equal(groupForPage(groups, layerGroups, layered), layerGroups[0]!.get(5));
  assert.equal(groupForPage(groups, layerGroups, untouched), groups[0]);
});

// Behaviour 21: everyGroup walks the layer-0 batches and their twins.
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

test('a layered cluster draws the source material on a record that carries the layer bias', () => {
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
      material: surfaceOf(original),
      declaration: original,
    }),
    page({
      renderOrder: 0,
      depthLayer: 3,
      id: 1,
      url: 'b',
      attributes: shared,
      material: surfaceOf(original),
      declaration: original,
    }),
  ];
  const batches = new ClusterBatches(scene, pages);
  for (const rec of pages) {
    const array = Uint32Array.from([0, 1, 2]);
    rec.array = array;
    batches.acceptPage([rec], array);
  }
  batches.update(pages);
  const units = batches.drawList.map((draw) => (draw as ClusterDrawMesh).polygonOffsetUnits);
  assert.deepEqual(units, [undefined, -depthLayerUnits(3)], 'one record per layer, biased above 0');
  assert.ok(
    batches.drawList.every((draw) => draw.material === original),
    'both records draw the source material: nothing was cloned',
  );
  batches.dispose();
  assert.equal(batches.drawList.length, 0);
  assert.equal(scene.children.length, 0, 'no draw record ever entered the host scene');
});
