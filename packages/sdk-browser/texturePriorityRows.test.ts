import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createTexturePriorityRows,
  ROW_NO_KEY,
  ROW_NO_LAYERS,
  type MaterialLayerIndex,
} from './texturePriorityRows.ts';
import type { PageRec } from './pageSelection.ts';

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

// La preuve d'équivalence avec le chemin d'avant — la sphère reconstruite par page, la projection
// écrite à la main — est tenue par `bench/pompe-textures.bench.mjs` contre l'oracle gelé de
// `bench/oracles/pompe-textures.mjs`, au bit près sur les poids. Elle ne l'est plus ici : le chemin
// d'avant a quitté le code livré, et un test ne peut pas prouver deux côtés dont un seul existe.
