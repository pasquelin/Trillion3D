// Lot F, F18 : trois calculs de la préparation d'un moteur WebGPU. `prepareCones`
// (webgpuPagesPrepare.ts) copie un attribut position simple par bloc au lieu d'accesseurs sommet par
// sommet, et lit le matériau une seule fois au lieu de deux. `indexSourceBytes` et
// `compteMateriauxEtTangentes` (webgpuPagesCatalogue.ts) remplacent un `flatMap` d'un couple par page
// et un `map`/deux copies de table par un seul parcours chacun. Les oracles sont les implémentations
// d'avant le lot F, recopiées telles quelles dans `oracles/cones-normaux.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareCones } from './webgpuPagesPrepare.ts';
import { indexSourceBytes, compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import {
  entreeCones,
  referencePrepareCones,
  referenceIndexSourceBytes,
  referenceCompteMateriauxEtTangentes,
} from './bench/oracles/cones-normaux.mjs';
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
/** L'entrée de `prepareCones`, celle du banc : une seule écriture pour les deux, sans quoi l'une
 *  des deux reste à l'ancien contrat sans que rien ne le dise. */
function runtime(allPages: PageRec[], roots?: Array<{ cones?: boolean; pages: PageRec[] }>) {
  return entreeCones(allPages, roots) as unknown as WebgpuPagesRuntime;
}
const positions = (values: number[]) => new THREE.Float32BufferAttribute(values, 3);

function memeCones(pages: PageRec[]) {
  const a = pages.map((p) => ({ ...p }) as unknown as PageRec);
  const b = pages.map((p) => ({ ...p }) as unknown as PageRec);
  prepareCones(runtime(a));
  referencePrepareCones(runtime(b));
  for (let i = 0; i < a.length; i++) assert.deepEqual(a[i].cone, b[i].cone, `page ${i}`);
}

test('l’entrée partagée porte des racines, et un cluster ordinaire en ressort avec un vrai cône', () => {
  // Deux fonctions qui ne posent rien seraient d’accord sur rien : l’égalité avec l’oracle ne dit
  // pas, à elle seule, qu’un cône a été posé. `prepareCones` lit les pages par racine — une entrée
  // qui n’en porterait pas lui ferait tout ignorer en silence, et c’est exactement la panne que ce
  // correctif ferme. Ce test l’exige donc des deux côtés : des racines, et un cône non vide.
  const entree = entreeCones([]) as { setup: { allPages: PageRec[]; roots: unknown[] } };
  assert.ok(Array.isArray(entree.setup.roots), 'l’entrée du banc doit porter ses racines');
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const page = triangle(new THREE.MeshBasicMaterial({ side: THREE.FrontSide }), attributes);
  prepareCones(runtime([page]));
  assert.ok(page.cone, 'un cluster à une face doit recevoir son cône');
  assert.equal(page.cone!.axis.length, 3);
});

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

test('poser un cône déclare sa racine ; une racine dont aucune page ne reçoit de cône reste déclarée nue', () => {
  // `collectClusterPages` déclare `cones: false` ; sans ce relevé, la coupe ne lirait plus le cône
  // que cette préparation vient d'écrire, et le rejet de cône disparaîtrait sans bruit. Une page
  // sans octets d'index ne reçoit aucun cône : sa racine n'a rien à déclarer.
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const porte = triangle(new THREE.MeshBasicMaterial(), attributes);
  const nue = { ...triangle(new THREE.MeshBasicMaterial(), attributes), array: undefined };
  const roots = [
    { cones: false, pages: [porte] },
    { cones: false, pages: [nue as unknown as PageRec] },
  ];
  prepareCones(runtime([porte, nue as unknown as PageRec], roots));
  assert.equal(roots[0].cones, true);
  assert.equal(roots[1].cones, false);
});
