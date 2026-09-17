import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createTexturePriorityRows,
  ROW_NO_KEY,
  ROW_NO_LAYERS,
  type MaterialLayerIndex,
} from './texturePriorityRows.ts';
import { createTexturePriority, type PriorityCamera } from './webgpuTexturePriority.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

const MATRIX = new THREE.Matrix4();
const page = (material: THREE.Material, key: number | undefined, half: number): PageRec =>
  ({
    material,
    matrix: MATRIX,
    keyIndex: key,
    min: [-half, -half, -half - 10],
    max: [half, half, half - 10],
  }) as PageRec;

test('deux placements d’une même grappe partagent une ligne, bâtie une seule fois', () => {
  const material = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([[material, { color: [1], data: [2] }]]);
  const rows = createTexturePriorityRows();
  assert.equal(rows.open(index, 4), true);
  // Le second placement porte une boîte deux fois plus grande ; la clé étant la même, c'est la
  // grappe qui décide, et sa boîte est celle de la primitive, pas celle d'un placement.
  assert.equal(rows.of(page(material, 2, 1)), 2);
  assert.equal(rows.of(page(material, 2, 2)), 2);
  assert.equal(rows.views.sphere[2 * 4 + 3], Math.hypot(1, 1, 1));
});

test('sans clé de grappe la ligne est refusée, et un matériau hors index ne dépose rien', () => {
  const connu = new THREE.MeshStandardMaterial(),
    inconnu = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([[connu, { color: [1], data: [] }]]);
  const rows = createTexturePriorityRows();
  rows.open(index, 4);
  assert.equal(rows.of(page(connu, undefined, 1)), ROW_NO_KEY);
  assert.equal(rows.of(page(connu, 9, 1)), ROW_NO_KEY);
  assert.equal(rows.of(page(inconnu, 1, 1)), ROW_NO_LAYERS);
  assert.equal(rows.of(page(connu, 0, 1)), 0);
});

test('sans index ou sans catalogue, aucune ligne n’est ouverte', () => {
  const rows = createTexturePriorityRows();
  assert.equal(rows.open(undefined, 8), false);
  assert.equal(rows.open(new Map(), 0), false);
});

test('un index de matériaux neuf jette les lignes : les couches suivies sont les siennes', () => {
  const material = new THREE.MeshStandardMaterial();
  const rows = createTexturePriorityRows();
  rows.open(new Map([[material, { color: [1], data: [] }]]), 4);
  assert.equal(rows.of(page(material, 0, 1)), 0);
  const { colorAt, colorCount, layers, material: rank } = rows.views;
  assert.equal(layers[colorAt[rank[0]]], 1);
  assert.equal(colorCount[rank[0]], 1);
  // La préparation rebâtit un index entier ; la même clé doit suivre sa nouvelle couche.
  rows.open(new Map([[material, { color: [7], data: [] }]]), 4);
  assert.equal(rows.of(page(material, 0, 1)), 0);
  const apres = rows.views;
  assert.equal(apres.layers[apres.colorAt[apres.material[0]]], 7);
});

/** Une caméra de vue identité : un point du monde est son propre point de vue. */
function camera(): PriorityCamera {
  const view = new Float64Array(16);
  view[0] = view[5] = view[10] = view[15] = 1;
  const projection = new Float64Array(16);
  projection[0] = projection[5] = 1;
  return { view, projection, near: 0.1 };
}
function job(slot: number, kind: TextureJob['kind'] = 'color'): TextureJob {
  return {
    kind,
    slot,
    classIndex: 0,
    layer: slot,
    level: 0,
    stage: 1,
    bytes: 4,
    rows: 1,
    bytesPerRow: 4,
    nextRow: 0,
    failures: 0,
    uploadRows: () => {},
  };
}

/**
 * La preuve du lot : le chemin à plat et le chemin d'avant donnent le même ordre ET les mêmes poids.
 *
 * Les poids sont comparés au bit près — `scoreOf` rend l'aire écran d'une couche par ses niveaux
 * manquants, donc la somme des empreintes que la boucle a déposées. Une sphère reconstruite
 * autrement, une projection écrite autrement, un dépôt dans un autre ordre s'y verraient.
 */
test('le chemin à plat et le chemin par page rendent le même ordre et les mêmes poids', () => {
  const MATERIAUX = 6,
    PAGES = 48;
  const materiaux = Array.from({ length: MATERIAUX }, () => new THREE.MeshStandardMaterial());
  const index: MaterialLayerIndex = new Map(
    materiaux.map((material, i) => [material, { color: [1 + i * 2], data: [2 + i * 2] }]),
  );
  const texels = new Float64Array(2 * MATERIAUX + 2).fill(4096);
  let graine = 7;
  const alea = () => (graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grappes = Array.from({ length: PAGES }, () => 0.2 + alea() * 4);
  // Les mêmes grappes, les mêmes matériaux, le même ordre : seule la clé change d'un côté à l'autre.
  const avec = grappes.map((half, i) => page(materiaux[i % MATERIAUX], i, half));
  const sans = grappes.map((half, i) => page(materiaux[i % MATERIAUX], undefined, half));
  const priorityDe = (requested: PageRec[], keyCount: number) =>
    createTexturePriority(() => ({
      index,
      requested,
      blend: [] as BlendGpuItem[],
      cam: camera(),
      viewport: [1000, 1000] as const,
      colorTexels: texels,
      dataTexels: texels,
      keyCount,
    }));
  const plat = priorityDe(avec, PAGES),
    parPage = priorityDe(sans, 0);
  const travaux = () =>
    Array.from({ length: 2 * MATERIAUX }, (_, i) => job(1 + i, i % 2 ? 'data' : 'color'));
  const a = travaux(),
    b = travaux();
  plat.order(a);
  parPage.order(b);
  assert.deepEqual(
    a.map((entry) => [entry.slot, entry.kind]),
    b.map((entry) => [entry.slot, entry.kind]),
  );
  for (let slot = 1; slot <= 2 * MATERIAUX; slot++)
    for (const kind of ['color', 'data'] as const)
      assert.equal(plat.scoreOf(job(slot, kind)), parPage.scoreOf(job(slot, kind)));
  assert.deepEqual({ ...plat.counters }, { ...parPage.counters });
});
