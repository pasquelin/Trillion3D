// Défaut 2 : `setTransform` réduisait la matrice demandée à un produit translation-rotation-échelle,
// et `updateMatrixWorld` recomposait par-dessus la matrice posée. Toute matrice n'étant pas un tel
// produit, le moteur dessinait alors une autre transformation que celle demandée. Ces tests tiennent
// la matrice monde effective — celle qui part au GPU par `root.world.elements` — contre celle
// demandée, sur des matrices à cisaillement, sous parent, et sur les cas conformes qui ne doivent
// pas bouger.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOX_VALUES, boxTransform } from '../sdk-core/index.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { ClusterRoot, PageRec } from './pageSelectionTypes.ts';

/** Deux axes non orthogonaux : `y` pousse `x`. Aucune décomposition TRS ne rend cette matrice. */
function cisaillee(facteur = 3, tx = 0) {
  return new THREE.Matrix4().set(1, facteur, 0, tx, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}

const versGpu = (m: THREE.Matrix4) => new Float32Array(m.elements);

function proche(
  obtenu: ArrayLike<number>,
  attendu: ArrayLike<number>,
  tolerance: number,
  quoi: string,
) {
  for (let i = 0; i < attendu.length; i++)
    assert.ok(
      Math.abs(obtenu[i] - attendu[i]) <= tolerance,
      `${quoi}[${i}] : ${obtenu[i]} au lieu de ${attendu[i]}`,
    );
}

function scene(nom = 'cible') {
  const source = new THREE.Object3D(),
    mesh = new THREE.Mesh();
  mesh.name = nom;
  source.add(mesh);
  source.updateMatrixWorld(true);
  return { source, mesh };
}

/** Une racine de sélection minimale : ce que la transformation reprojette et ce qu'elle envoie. */
function racine(mesh: THREE.Object3D, local: number[]) {
  const localBox = Float64Array.from(local),
    worldBox = new Float64Array(BOX_VALUES);
  boxTransform(worldBox, 0, localBox, 0, mesh.matrixWorld.elements);
  return {
    world: mesh.matrixWorld,
    pages: [{ sourceMesh: mesh } as unknown as PageRec],
    worldBox,
    localBox,
  } as ClusterRoot<PageRec>;
}

function runtime(source: THREE.Object3D, roots: Array<ClusterRoot<PageRec>> = []) {
  const mouvements: Array<{ min: number[]; max: number[] }> = [],
    layout = { selectionRoots: roots, rows: { tableEpoch: 0 } },
    // L'état d'image du moteur, tel que le runtime le porte : `setWebgpuTransform` y incrémente la
    // révision de scène et y aligne `worldsRevision`. Un état partiel masquerait ce contrat.
    run = createWebgpuRunState();
  run.noOccluderHistory = false;
  run.temporalHizState = { pyramid: {}, camera: {} } as typeof run.temporalHizState;
  const rt = {
    setup: { source },
    layout,
    run,
    lights: {
      plan: {
        worldChanged: (min: number[], max: number[]) =>
          mouvements.push({ min: [...min], max: [...max] }),
      },
    },
  } as unknown as WebgpuPagesRuntime;
  return { rt, layout, run, mouvements };
}

test('la matrice monde à cisaillement demandée est celle que le nœud porte, au bit près', () => {
  const { source, mesh } = scene(),
    { rt } = runtime(source),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(mesh.matrixWorld.elements), Array.from(demandee));
});

test('une image suivante ne recompose pas la matrice posée depuis position, rotation et échelle', () => {
  const { source, mesh } = scene(),
    { rt } = runtime(source),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  source.updateMatrixWorld(true);
  source.updateMatrixWorld(true);
  assert.deepEqual(Array.from(mesh.matrixWorld.elements), Array.from(demandee));
});

test('sous un parent tourné et mis à l échelle, le monde obtenu reste le monde demandé', () => {
  const source = new THREE.Object3D(),
    parent = new THREE.Object3D(),
    mesh = new THREE.Mesh();
  mesh.name = 'cible';
  parent.position.set(2, -1, 3);
  parent.quaternion.setFromEuler(new THREE.Euler(0.3, -0.5, 0.2));
  parent.scale.set(2, 0.5, 4);
  parent.add(mesh);
  source.add(parent);
  source.updateMatrixWorld(true);
  const { rt } = runtime(source),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  proche(mesh.matrixWorld.elements, demandee, 1e-5, 'monde sous parent');
});

test('un parent lui-même cisaillé ne fausse pas le monde demandé pour son enfant', () => {
  const source = new THREE.Object3D(),
    parent = new THREE.Object3D(),
    mesh = new THREE.Mesh();
  mesh.name = 'cible';
  parent.add(mesh);
  source.add(parent);
  source.updateMatrixWorld(true);
  const { rt } = runtime(source);
  parent.name = 'porteur';
  setWebgpuTransform(rt, 'porteur', versGpu(cisaillee(2, 1)));
  const demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  proche(mesh.matrixWorld.elements, demandee, 1e-5, 'monde sous parent cisaillé');
});

test('la matrice envoyée au GPU par la racine de sélection porte le cisaillement', () => {
  const { source, mesh } = scene(),
    root = racine(mesh, [-1, -1, -1, 1, 1, 1]),
    { rt } = runtime(source, [root]),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(root.world.elements), Array.from(demandee));
});

test('la boîte monde reprojetée est l image de la boîte locale par la matrice cisaillée', () => {
  const { source, mesh } = scene(),
    local = [-1, -1, -1, 1, 1, 1],
    root = racine(mesh, local),
    avant = Array.from(root.worldBox!),
    { rt, mouvements } = runtime(source, [root]),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  const attendu = new Float64Array(BOX_VALUES);
  boxTransform(attendu, 0, Float64Array.from(local), 0, demandee);
  assert.deepEqual(Array.from(root.worldBox!), Array.from(attendu));
  assert.equal(root.worldBox![0], 2, 'le cisaillement étend la boîte, une décomposition TRS non');
  assert.equal(mouvements.length, 1);
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(mouvements[0].min[axis], Math.min(avant[axis], attendu[axis]));
    assert.equal(mouvements[0].max[axis], Math.max(avant[axis + 3], attendu[axis + 3]));
  }
});

test('une matrice conforme translation-rotation-échelle reste exacte, champs compris', () => {
  const { source, mesh } = scene(),
    { rt } = runtime(source),
    conforme = new THREE.Matrix4().compose(
      new THREE.Vector3(2, -1, 3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.5, 0.2)),
      new THREE.Vector3(1.5, 1.5, 1.5),
    ),
    demandee = versGpu(conforme);
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(mesh.matrixWorld.elements), Array.from(demandee));
  proche([mesh.position.x, mesh.position.y, mesh.position.z], [2, -1, 3], 1e-6, 'position');
  proche([mesh.scale.x, mesh.scale.y, mesh.scale.z], [1.5, 1.5, 1.5], 1e-6, 'échelle');
});

test('une échelle négative garde son déterminant négatif, donc son sens de faces', () => {
  const { source, mesh } = scene(),
    { rt } = runtime(source),
    demandee = versGpu(new THREE.Matrix4().makeScale(1, -2, 3));
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(mesh.matrixWorld.elements), Array.from(demandee));
  assert.ok(mesh.matrixWorld.determinant() < 0, 'déterminant négatif conservé');
});

test('deux déplacements successifs ne s accumulent pas et la table est déclarée changée', () => {
  const { source, mesh } = scene(),
    { rt, layout, run } = runtime(source),
    premier = versGpu(cisaillee(3, 6)),
    second = versGpu(cisaillee(-2, -4));
  setWebgpuTransform(rt, 'cible', premier);
  setWebgpuTransform(rt, 'cible', second);
  assert.deepEqual(Array.from(mesh.matrixWorld.elements), Array.from(second));
  assert.equal(layout.rows.tableEpoch, 2);
  assert.equal(run.noOccluderHistory, true);
  assert.equal(run.temporalHizState.pyramid, undefined);
  // Sans cet incrément, la porte d'image tiendrait l'image précédente et le nœud déplacé resterait
  // dessiné là où il était ; `worldsRevision` suit, la hiérarchie portant déjà ces matrices.
  assert.equal(run.revisions.scene, 3, 'une révision de scène par déplacement');
  assert.equal(run.worldsRevision, run.revisions.scene);
});
