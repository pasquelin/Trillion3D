// Lot M3a, mathTransformTreeLookAt.ts : `lookAt` pour un objet et pour une caméra, cas limite de la
// visée colinéaire au haut, retrait de la rotation du parent, et parent d'échelle nulle (aucune
// division par zéro qui ferait lever).
//
// Lot M4a : `lookAtRows` garde le carré de la norme au lieu de le recalculer (sauf branche
// dégénérée), et `extractRotationRows` lit la matrice du parent dans le tampon plat de l'arbre à un
// décalage plutôt que par `worldViews`. Les trois tests ci-dessous confrontent ces chemins au bit
// près (Object.is) à `Object3D.lookAt`/`Camera.lookAt` de la référence.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './mathTransformTree.ts';
import { lookAtNode } from './mathTransformTreeLookAt.ts';
import { nodeWorldDirection } from './mathTransformTreeRead.ts';
import { updateNodeMatrixWorld } from './mathTransformTreeUpdate.ts';
import { assertBits } from './bench/oracles/volumes.mjs';

const HAUT = [0, 1, 0];
const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const direction = (tree: ReturnType<typeof createTransformTree>, node: number, viewer: boolean) => {
  updateNodeMatrixWorld(tree, node, true);
  const out = new Float64Array(3);
  nodeWorldDirection(out, tree, node, viewer);
  return [...out];
};

test('lookAt d’une caméra : la direction de vue (-z) pointe vers la cible', () => {
  const tree = createTransformTree(4);
  const camera = addTransformNode(tree);
  updateNodeMatrixWorld(tree, camera, true); // pose la caméra à l’origine d’abord
  lookAtNode(tree, camera, 0, 0, -10, HAUT, true);
  const d = direction(tree, camera, true);
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1));
});

test('lookAt d’un objet : la direction présentée (+z) pointe vers la cible, à l’opposé de la caméra pour la même visée', () => {
  const tree = createTransformTree(4);
  const objet = addTransformNode(tree);
  lookAtNode(tree, objet, 0, 0, -10, HAUT, false);
  const d = direction(tree, objet, false);
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1));
});

test('lookAt : l’œil déjà sur la cible ne lève pas, l’axe z retombe sur (0,0,1)', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  assert.doesNotThrow(() => lookAtNode(tree, node, 0, 0, 0, HAUT, true));
});

test('lookAt : visée colinéaire au haut ne lève pas et rend un axe de vue non nul', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  updateNodeMatrixWorld(tree, node, true);
  lookAtNode(tree, node, 0, -10, 0, HAUT, true); // cible droit sous le haut (0,1,0)
  const d = direction(tree, node, true);
  const norme = Math.hypot(d[0], d[1], d[2]);
  assert.ok(proche(norme, 1), `direction non normalisée : ${d}`);
});

test('lookAt sous un parent tourné : la rotation locale retire celle du parent', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  setNodeQuaternion(tree, parent, 0, 1, 0, 0); // demi-tour du parent autour de y
  const enfant = addTransformNode(tree, parent);
  lookAtNode(tree, enfant, 0, 0, -10, HAUT, true);
  const d = direction(tree, enfant, true);
  // Malgré le demi-tour du parent, la direction monde de la caméra vise toujours -z.
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1), `direction : ${d}`);
});

test('lookAt sous un parent d’échelle nulle : ne lève pas (extractRotationRows divise par une norme de colonne, pas par l’échelle)', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  setNodeScale(tree, parent, 0, 1, 1);
  const enfant = addTransformNode(tree, parent);
  updateNodeMatrixWorld(tree, parent, true);
  assert.doesNotThrow(() => lookAtNode(tree, enfant, 1, 1, 1, HAUT, false));
});

/** Le quaternion local `(x, y, z, w)` que `lookAtNode` a posé sur `node`. */
const quat = (tree: ReturnType<typeof createTransformTree>, node: number) => [
  tree.quaternion[node * 4],
  tree.quaternion[node * 4 + 1],
  tree.quaternion[node * 4 + 2],
  tree.quaternion[node * 4 + 3],
];

test('lookAt d’une caméra sous un parent profond (3), tourné et mis à l’échelle : quaternion local identique au bit près à Camera.lookAt (carré de la norme gardé, parent lu à un décalage)', () => {
  const tree = createTransformTree(8);
  const grandParent = addTransformNode(tree);
  setNodePosition(tree, grandParent, 2, 0, 0);
  setNodeQuaternion(tree, grandParent, 0, 0.38268343236509, 0, 0.9238795325112867);
  const parent = addTransformNode(tree, grandParent);
  setNodePosition(tree, parent, 0, 3, 0);
  setNodeQuaternion(tree, parent, 0.2705980500730985, 0, 0, 0.9629160522751163);
  setNodeScale(tree, parent, 2, 2, 2);
  const camera = addTransformNode(tree, parent);
  setNodePosition(tree, camera, 1, -1, 2);
  // Rotation locale initiale, distincte de celle du parent : si `extractRotationRows` lisait la
  // matrice monde de la caméra elle-même au lieu de celle du parent, cette valeur fuirait dans le
  // résultat au lieu d'être entièrement écrasée, comme le fait la référence.
  setNodeQuaternion(tree, camera, 0.7071067811865476, 0, 0, 0.7071067811865476);
  updateNodeMatrixWorld(tree, camera, true);
  lookAtNode(tree, camera, 5, 5, -5, HAUT, true);

  const gp = new THREE.Object3D();
  gp.position.set(2, 0, 0);
  gp.quaternion.set(0, 0.38268343236509, 0, 0.9238795325112867);
  const p = new THREE.Object3D();
  p.position.set(0, 3, 0);
  p.quaternion.set(0.2705980500730985, 0, 0, 0.9629160522751163);
  p.scale.set(2, 2, 2);
  gp.add(p);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(1, -1, 2);
  p.add(cam);
  gp.updateMatrixWorld(true);
  cam.lookAt(5, 5, -5);

  assertBits(quat(tree, camera), [
    cam.quaternion.x,
    cam.quaternion.y,
    cam.quaternion.z,
    cam.quaternion.w,
  ]);
});

test('lookAt : branche dégénérée (visée colinéaire au haut) identique au bit près à Object3D.lookAt/Camera.lookAt, caméra et objet', () => {
  for (const viewer of [true, false]) {
    const tree = createTransformTree(4);
    const node = addTransformNode(tree);
    updateNodeMatrixWorld(tree, node, true);
    lookAtNode(tree, node, 0, -10, 0, HAUT, viewer); // cible droit sous le haut (0, 1, 0)
    const obj = viewer ? new THREE.PerspectiveCamera() : new THREE.Object3D();
    obj.lookAt(0, -10, 0);
    assertBits(quat(tree, node), [
      obj.quaternion.x,
      obj.quaternion.y,
      obj.quaternion.z,
      obj.quaternion.w,
    ]);
  }
});

test('lookAt : branche dégénérée avec un haut vertical (0,0,1) identique au bit près à la référence (l’autre sous-branche, `zx += 0,0001`)', () => {
  const HAUT_Z = [0, 0, 1];
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  updateNodeMatrixWorld(tree, node, true);
  lookAtNode(tree, node, 0, 0, -10, HAUT_Z, true); // cible colinéaire à ce haut
  const cam = new THREE.PerspectiveCamera();
  cam.up.set(0, 0, 1);
  cam.lookAt(0, 0, -10);
  assertBits(quat(tree, node), [
    cam.quaternion.x,
    cam.quaternion.y,
    cam.quaternion.z,
    cam.quaternion.w,
  ]);
});
