// Lot F, F18 : trois calculs de la préparation d'un moteur WebGPU. `prepareCones`
// (webgpuPagesPrepare.ts) copie un attribut position simple par bloc au lieu d'accesseurs sommet par
// sommet, et lit le matériau une seule fois au lieu de deux. `indexSourceBytes` et
// `compteMateriauxEtTangentes` (webgpuPagesCatalogue.ts) remplacent un `flatMap` d'un couple par page
// et un `map`/deux copies de table par un seul parcours chacun. Les oracles sont les implémentations
// d'avant le lot F, recopiées telles quelles dans `oracles/f-cones.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareCones } from './webgpuPagesPrepare.ts';
import { indexSourceBytes, compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import {
  referencePrepareCones,
  referenceIndexSourceBytes,
  referenceCompteMateriauxEtTangentes,
} from './bench/oracles/f-cones.mjs';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function triangle(material: THREE.Material, attributes: THREE.BufferGeometry['attributes']) {
  return {
    array: Uint32Array.of(0, 1, 2),
    attributes,
    material,
    cone: undefined,
  } as unknown as PageRec;
}
function runtime(allPages: PageRec[], roots: Array<{ cones?: boolean }> = []) {
  return { setup: { allPages, roots } } as unknown as WebgpuPagesRuntime;
}
const positions = (values: number[]) => new THREE.Float32BufferAttribute(values, 3);

function memeCones(pages: PageRec[]) {
  const a = pages.map((p) => ({ ...p }) as unknown as PageRec);
  const b = pages.map((p) => ({ ...p }) as unknown as PageRec);
  prepareCones(runtime(a));
  referencePrepareCones(runtime(b));
  for (let i = 0; i < a.length; i++) assert.deepEqual(a[i].cone, b[i].cone, `page ${i}`);
}

test('un attribut position simple, non normalisé, prend le même cône que la copie sommet par sommet', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([triangle(new THREE.MeshBasicMaterial(), attributes)]);
});

test('un attribut normalisé repasse par les accesseurs et rend le même cône que la référence', () => {
  const attr = positions([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  attr.normalized = true;
  memeCones([triangle(new THREE.MeshBasicMaterial(), { position: attr })]);
});

test('un attribut entrelacé repasse par les accesseurs et rend le même cône que la référence', () => {
  const interleaved = new THREE.InterleavedBuffer(
    Float32Array.of(0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9),
    4,
  );
  const attr = new THREE.InterleavedBufferAttribute(interleaved, 3, 0, false);
  memeCones([triangle(new THREE.MeshBasicMaterial(), { position: attr })]);
});

test('un matériau double face ou vu de dos rend OPEN_CONE des deux côtés, sans calculer de cône', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([
    triangle(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), attributes),
    triangle(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), attributes),
  ]);
});

test('sans octets d’index ou sans attribut position, la page est ignorée des deux côtés (cone laissé intact)', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const sansArray = { ...triangle(new THREE.MeshBasicMaterial(), attributes), array: undefined };
  const sansPosition = {
    ...triangle(new THREE.MeshBasicMaterial(), {}),
    array: Uint32Array.of(0, 1, 2),
  };
  memeCones([sansArray as unknown as PageRec, sansPosition as unknown as PageRec]);
});

test('deux pages partageant le même attribut ne recalculent le tableau plat qu’une fois, même résultat', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([
    triangle(new THREE.MeshBasicMaterial(), attributes),
    triangle(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), attributes),
  ]);
});

test('indexSourceBytes rend la même table que le flatMap de référence, dernière page d’une adresse gagnante', () => {
  const a = { url: 'p/0', array: Uint32Array.of(1, 2, 3) } as unknown as PageRec;
  const b = { url: 'p/1', array: undefined } as unknown as PageRec; // pas d'octets : absent des deux
  const c = { url: 'p/0', array: Uint32Array.of(9, 9) } as unknown as PageRec; // même adresse que a
  const pages = [a, b, c];
  const obtenu = indexSourceBytes(pages);
  const attendu = referenceIndexSourceBytes(pages);
  assert.deepEqual([...obtenu.keys()], [...attendu.keys()]);
  for (const [url, bytes] of obtenu)
    assert.deepEqual(Array.from(bytes), Array.from(attendu.get(url)));
});

test('indexSourceBytes sur un catalogue vide rend une table vide', () => {
  assert.deepEqual(indexSourceBytes([]), referenceIndexSourceBytes([]));
});

test('compteMateriauxEtTangentes compte les matériaux distincts et les géométries avec/sans tangentes', () => {
  const materialA = new THREE.MeshBasicMaterial(),
    materialB = new THREE.MeshBasicMaterial();
  const pages = [
    { material: materialA } as unknown as PageRec,
    { material: materialA } as unknown as PageRec, // même matériau, ne recompte pas
    { material: materialB } as unknown as PageRec,
  ];
  const geometryBlocks = new Map<unknown, { hasTangent: boolean }>([
    ['g0', { hasTangent: true }],
    ['g1', { hasTangent: false }],
    ['g2', { hasTangent: true }],
  ]);
  assert.deepEqual(
    compteMateriauxEtTangentes(pages, geometryBlocks),
    referenceCompteMateriauxEtTangentes(pages, geometryBlocks),
  );
});

test('compteMateriauxEtTangentes sur un catalogue et une table de géométries vides rend des zéros', () => {
  assert.deepEqual(
    compteMateriauxEtTangentes([], new Map()),
    referenceCompteMateriauxEtTangentes([], new Map()),
  );
});

test('poser des cônes déclare les racines qui en portent : la coupe cesse alors de les croire nues', () => {
  // `collectClusterPages` déclare `cones: false` ; sans ce relevé, la coupe ne lirait plus le cône
  // que cette préparation vient d'écrire, et le rejet de cône disparaîtrait sans bruit.
  const roots = [{ cones: false }, { cones: false }];
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  prepareCones(runtime([triangle(new THREE.MeshBasicMaterial(), attributes)], roots));
  for (const root of roots) assert.equal(root.cones, true);
});
