// Charges du banc de performance de la hiérarchie (lot M3a) : même scène et même travail des deux côtés,
// des `Object3D` de Three.js contre la hiérarchie à plat de sdk-core. Une scène de `n` nœuds sous une
// racine, parent tiré parmi les précédents, poses ordinaires dont une échelle sur quatre en miroir.
// Une opération est un nœud mis à jour ou lu, ou une image de caméra. Chaque ligne sait vérifier que
// les deux côtés ont rendu les mêmes bits.
import * as THREE from 'three';
import {
  addTransformNode,
  createTransformTree,
  nodeWorldPosition,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  updateNodeMatrixWorld,
} from '../../sdk-core/index.ts';
import { graine } from '../../sdk-core/bench/banc.mjs';

/** Au moins cent mille opérations par répétition : une durée lisible même pour mille nœuds. */
const OPERATIONS_MIN = 100_000;
export const memes = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** La même scène des deux côtés, mise à jour une première fois. */
function scene(n) {
  const alea = graine(0x5eed + n);
  const tree = createTransformTree(n),
    objets = [];
  for (let i = 0; i < n; i++) {
    const parent = i ? Math.floor(alea() * i) : -1;
    const q = new THREE.Quaternion(
      alea() - 0.5,
      alea() - 0.5,
      alea() - 0.5,
      alea() - 0.5,
    ).normalize();
    const p = [(alea() - 0.5) * 20, (alea() - 0.5) * 20, (alea() - 0.5) * 20];
    const s = [(i % 4 ? 1 : -1) * (0.5 + alea()), 0.5 + alea(), 0.5 + alea()];
    const o = new THREE.Object3D();
    o.position.fromArray(p);
    o.quaternion.copy(q);
    o.scale.fromArray(s);
    if (parent >= 0) objets[parent].add(o);
    objets.push(o);
    addTransformNode(tree, parent);
    setNodePosition(tree, i, p[0], p[1], p[2]);
    setNodeQuaternion(tree, i, q.x, q.y, q.z, q.w);
    setNodeScale(tree, i, s[0], s[1], s[2]);
  }
  objets[0].updateMatrixWorld(true);
  updateNodeMatrixWorld(tree, 0, true);
  return {
    tree,
    objets,
    v: new THREE.Vector3(),
    lu: new Float64Array(3),
    sommeThree: 0,
    sommeNous: 0,
  };
}

const mondesIdentiques = (c) =>
  c.objets.every((o, i) => memes(o.matrixWorld.elements, c.tree.worldViews[i]));

/** Une ligne : chaque passage répète le corps jusqu'au minimum d'opérations. */
export function ligne(famille, nom, taille, parTour, c, three, nous, verifie) {
  const tours = Math.max(1, Math.ceil(OPERATIONS_MIN / parTour));
  let pasThree = 0,
    pasNous = 0;
  return {
    famille,
    nom,
    taille,
    operations: tours * parTour,
    three: () => {
      for (let t = 0; t < tours; t++) three(c, pasThree++);
    },
    nous: () => {
      for (let t = 0; t < tours; t++) nous(c, pasNous++);
    },
    verifie: () => (verifie(c) ? null : 'les deux côtés ne rendent pas les mêmes bits'),
  };
}

/** Déplace les nœuds `i ≡ 0 (mod pas)` d'un décalage qui dépend du tour, puis met à jour la racine. */
const bougeThree = (pas) => (c, tour) => {
  const dx = tour % 2 ? 0.5 : -0.5;
  for (let i = 0; i < c.objets.length; i += pas) c.objets[i].position.x += dx;
  c.objets[0].updateMatrixWorld();
};
const bougeNous = (pas) => (c, tour) => {
  const dx = tour % 2 ? 0.5 : -0.5,
    { tree } = c,
    p = tree.position;
  for (let i = 0; i < tree.end; i += pas)
    setNodePosition(tree, i, p[i * 3] + dx, p[i * 3 + 1], p[i * 3 + 2]);
  updateNodeMatrixWorld(tree, 0);
};

const lisThree = (c) => {
  let somme = 0;
  for (const o of c.objets) somme += o.getWorldPosition(c.v).x;
  c.sommeThree = somme;
};
const lisNous = (c) => {
  let somme = 0;
  for (let i = 0; i < c.tree.end; i++) somme += nodeWorldPosition(c.lu, c.tree, i)[0];
  c.sommeNous = somme;
};

/** Mise à jour de hiérarchies de 1 000, 10 000 et 100 000 nœuds, puis lecture des positions monde. */
export function* groupesHierarchie() {
  for (const n of [1_000, 10_000, 100_000]) {
    const c = scene(n);
    const cas = [
      ['tout sale', 1],
      ['1 % sale', 100],
      ['une racine qui bouge', n],
    ];
    yield cas.map(([nom, pas]) =>
      ligne(
        'hiérarchie',
        `mise à jour, ${nom} (op = nœud)`,
        n,
        n,
        c,
        bougeThree(pas),
        bougeNous(pas),
        mondesIdentiques,
      ),
    );
    yield [
      ligne('hiérarchie', 'positions monde lues (op = nœud)', n, n, c, lisThree, lisNous, (k) =>
        Object.is(k.sommeThree, k.sommeNous),
      ),
    ];
  }
}
