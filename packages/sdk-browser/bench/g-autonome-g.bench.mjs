// G1 : le backend autonome détache par le delta de la coupe au lieu de balayer tout le DAG. Deux
// mondes jumeaux, l'un mené par l'oracle, l'autre par la bibliothèque : ils voient la même suite de
// coupes, donc leurs scènes doivent rester identiques image après image.
import * as THREE from 'three';
import { createAutonomousGeometry } from '../autonomousGeometry.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeG } from '../../sdk-core/bench/bancG.mjs';
import { referenceAutonomousSync } from './oracles/g-autonome.mjs';

/** Nombres de triangles hostiles : zéro signé, NaN, infinis — la somme doit tomber au même bit. */
const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];

const geometrie = new THREE.BufferGeometry();
const materiau = new THREE.MeshBasicMaterial();

/** Un DAG de `total` pages, toutes décodées : seule la coupe décide de ce qui est attaché. */
function monde(total, depart) {
  const alea = graine(depart);
  const scene = new THREE.Scene(),
    allPages = [];
  for (let i = 0; i < total; i++)
    allPages.push({
      id: i,
      attached: false,
      mesh: undefined,
      geometry: geometrie,
      material: materiau,
      renderOrder: i,
      matrix: new THREE.Matrix4().makeTranslation(alea(), alea(), alea()),
      array: new Uint32Array(3),
      triangles: i < HOSTILES.length ? HOSTILES[i] : Math.floor(alea() * 400),
    });
  return { scene, allPages, shown: [], desired: [] };
}

/** Empreinte d'une image : les pages attachées dans l'ordre de la scène, et les triangles soumis.
 *  `renderOrder` porte l'identité de la page, et la scène ne contient que des pages attachées :
 *  l'empreinte coûte la taille de la coupe, pas celle du DAG, et ne fausse donc pas la mesure. */
const empreinte = (monde, triangles) => ({
  enfants: monde.scene.children.map((mesh) => mesh.renderOrder),
  triangles,
});

/** Une suite de coupes tirées du même générateur : la même pour les deux mondes. */
function coupes(total, tailles, depart) {
  const alea = graine(depart);
  return tailles.map((taille) => {
    const cut = [];
    for (let i = 0; i < taille; i++) cut.push(Math.floor(alea() * total) % Math.max(1, total));
    return [...new Set(cut)];
  });
}

/** Rejoue la suite de coupes sur un monde et rend l'empreinte de chaque image. */
const passe = (monde, sync, etat, suite) =>
  suite.map((indices) => {
    monde.shown.length = 0;
    for (const index of indices) monde.shown.push(monde.allPages[index]);
    sync();
    return empreinte(monde, etat.submittedTriangles);
  });

/** Un cas : deux mondes jumeaux, la même suite de coupes, chacun avec son moteur. */
function cas(nom, total, tailles, mesure) {
  const suite = coupes(total, tailles, 0x5eed ^ total);
  const gauche = monde(total, 0x9e37 ^ total),
    droite = monde(total, 0x9e37 ^ total);
  const oracle = referenceAutonomousSync(gauche);
  const paquet = createAutonomousGeometry({
    ...droite,
    bootstrap: [],
    byUrl: new Map(),
    descriptors: new Map(),
    baseMaterials: new Map(),
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  });
  return {
    nom,
    taille: total,
    mesure,
    entree: {
      reference: () => passe(gauche, oracle.sync, oracle.state, suite),
      optimisee: () => passe(droite, paquet.sync, paquet.state, suite),
    },
  };
}

const lignes = [
  await compare({
    calcul: 'G1 coupe du backend autonome',
    fichier: 'packages/sdk-browser/autonomousGeometry.ts',
    cas: [
      cas('20 000 pages, coupes de 200', 20000, [200, 200, 200, 200]),
      cas('4 000 pages, coupe entière puis vide', 4000, [4000, 0, 4000, 0]),
      cas('une seule page', 1, [1, 0, 1]),
      cas('aucune page', 0, [0, 0]),
      cas('sept pages aux triangles hostiles', 7, [7, 3, 7, 0]),
    ],
    reference: (entree) => entree.reference(),
    optimisee: (entree) => entree.optimisee(),
    options: { tours: 200, budgetMs: 2500 },
  }),
];

verifieEtDeposeG(
  'g-autonome',
  'G1 attache et détache exactement les mêmes pages, dans le même ordre de scène',
  lignes,
);
