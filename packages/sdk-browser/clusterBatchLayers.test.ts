import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLayerGroups, groupForPage, everyGroup } from './clusterBatchLayers.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';
import type { BatchPage } from './clusterBatchRange.ts';
import { ClusterBatches } from './clusterBatches.ts';
import { attributes } from './clusterBatchesFixture.ts';
import { depthLayerBias } from '../sdk-core/index.ts';

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

// Comportement 18 : buildLayerGroups crée un lot jumeau par (instance, couche) et aucun quand la
// scène n'a pas de couche.
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
    page({ renderOrder: 0, depthLayer: 2, id: 1 }), // même (instance, couche) : pas un second jumeau
    page({ renderOrder: 0, depthLayer: 3, id: 2 }), // même instance, autre couche : un autre jumeau
    page({ renderOrder: 1, depthLayer: 1, id: 3 }), // autre instance
  ];
  const built = buildLayerGroups(pages, groups);
  assert.equal(built.layerGroups[0]!.size, 2, 'deux couches distinctes sur la première instance');
  assert.equal(built.layerGroups[1]!.size, 1);
  assert.equal(built.materials.length, 3, 'un matériau biaisé par lot jumeau créé');
});

// Comportement 20 : biasedMaterial (testé via buildLayerGroups) pose polygonOffset, un facteur nul
// et des unités égales au biais de la couche.
test('the twin batch material carries polygonOffset with the layer bias in its units', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const pages = [page({ renderOrder: 0, depthLayer: 4 })];
  const built = buildLayerGroups(pages, groups);
  const biased = built.layerGroups[0]!.get(4)!.biased as THREE.MeshBasicMaterial;
  assert.equal(biased.polygonOffset, true);
  assert.equal(biased.polygonOffsetFactor, 0);
  assert.equal(biased.polygonOffsetUnits, depthLayerBias(4));
  assert.notEqual(biased, pages[0].material, 'le matériau biaisé est un clone, pas l’original');
});

// Comportement 19 : groupForPage route une page marquée vers son lot biaisé, une page de couche 0
// vers le lot d'origine.
test('groupForPage routes a layered page to its twin and a layer-0 page to the original group', () => {
  const groups: Array<BatchGroup | undefined> = [new BatchGroup({} as never)];
  const layered = page({ renderOrder: 0, depthLayer: 5 });
  const untouched = page({ renderOrder: 0, depthLayer: 0 });
  const built = buildLayerGroups([layered], groups);
  assert.equal(groupForPage(groups, built.layerGroups, layered), built.layerGroups[0]!.get(5));
  assert.equal(groupForPage(groups, built.layerGroups, untouched), groups[0]);
});

// Comportement 21 : everyGroup parcourt les lots de couche 0 et leurs jumeaux ; dispose libère les
// matériaux biaisés.
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
