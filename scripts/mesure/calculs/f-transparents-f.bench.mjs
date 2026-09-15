// F6 et F7 : la coupe transparente et les items de visibilité. F6 ne trie une coupe que lorsqu'un
// couple ne compare pas franchement « inférieur ou égal » — une clé NaN le fait échouer et le tri
// reprend la main — si bien que l'ordre rendu reste celui d'un tri stable. F7 lit l'enregistrement de
// la ligne une fois au lieu de trois, et sort la borne de couche de la boucle.
import * as THREE from 'three';
import { ordonneCoupeTransparente } from '../../../packages/sdk-browser/webgpuBlendSelection.ts';
import { buildWebgpuVisibilityItems } from '../../../packages/sdk-browser/webgpuVisibilityItems.ts';
import { HIZ_BOUNDS_VALUES } from '../../../packages/sdk-browser/hiz.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from '../../../packages/sdk-browser/gpuDraw.ts';
import { compare, graine } from './banc.mjs';
import { verifieEtDeposeF } from './bancF.mjs';
import { referenceBuildItems, referenceOrdonneCoupe } from './oracles/f-transparents.mjs';

const alea = graine(787);
const materiaux = [
  new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
];

/** Une coupe transparente : ordonnée, presque ordonnée, désordonnée, ou semée de clés NaN. */
const coupe = (taille, desordre, nan) => {
  const liste = [];
  for (let i = 0; i < taille; i++)
    liste.push({ id: i, sourceOrder: nan && alea() < 0.05 ? NaN : i });
  for (let i = 0; i < Math.floor(taille * desordre); i++) {
    const a = Math.floor(alea() * taille),
      b = Math.floor(alea() * taille);
    const tampon = liste[a];
    liste[a] = liste[b];
    liste[b] = tampon;
  }
  return liste;
};

const coupes = {
  ordonnee: coupe(4000, 0, false),
  presque: coupe(4000, 0.001, false),
  desordonnee: coupe(4000, 0.5, false),
  nan: coupe(400, 0.3, true),
  seule: coupe(1, 0, false),
  vide: [],
  identiques: Array.from({ length: 2000 }, (_, i) => ({ id: i, sourceOrder: 7 })),
};
const passeCoupe = (fn) => (entree) => fn(coupes[entree].map((rec) => rec));

/** Un jeu de lignes empaquetées : couches coplanaires, faces mêlées, moitié testée par le Hi-Z. */
const LIGNES = 20000,
  COUCHES = 4;
const recs = [];
for (let i = 0; i < LIGNES; i++) {
  const rec = {
    id: i,
    depthLayer: i % (COUCHES + 2),
    material: materiaux[i % 3],
    matrix: new THREE.Matrix4(),
    array: new Uint32Array(3 * (1 + (i % 16))),
  };
  if (i % 5 === 0) rec.matrix.makeScale(-1, 1, 1);
  recs.push(rec);
}
const hizBounds = new Float64Array(LIGNES * HIZ_BOUNDS_VALUES);
for (let i = 0; i < hizBounds.length; i++) hizBounds[i] = alea() * 2 - 1;
const hizRest = new Uint8Array(LIGNES);
for (let i = 0; i < LIGNES; i++) hizRest[i] = i % 3 ? 1 : 0;

const runtime = (packedCount) => ({
  vis: { drawLayerSlots: COUCHES },
  timing: { lastItemsMs: 0 },
  layout: {
    rows: {
      packedCount,
      packedRecs: recs,
      packedPageIndex: Int32Array.from(recs, (_, i) => i * 2),
    },
    hizRest,
    drawItemWords: new Uint32Array(LIGNES * DRAW_ITEM_U32),
    binInstances: new Uint32Array(BASE_SLOTS * 16),
    drawRestBits: new Uint32Array(Math.ceil(LIGNES / 32)),
    hizTestedBounds: new Float64Array(LIGNES * HIZ_BOUNDS_VALUES),
    hizBounds,
    hizTestedRows: new Int32Array(LIGNES),
    hizTestedTriangles: new Float64Array(LIGNES),
  },
});

/**
 * Un moteur par côté, monté une fois : la ligne mesure la passe, pas l'allocation des tampons. Les
 * deux moteurs voient la même suite de cas, donc leurs tampons évoluent de la même façon.
 */
const moteurs = new WeakMap();

/** L'état complet des tableaux d'items après la passe, et les trois compteurs qu'elle rend. */
const passeItems = (fn) => (entree) => {
  let rt = moteurs.get(fn);
  if (!rt) moteurs.set(fn, (rt = runtime(0)));
  rt.layout.rows.packedCount = entree.count;
  const compte = fn(rt, entree.twoPass, entree.itemsDirty);
  return {
    compte,
    drawItemWords: rt.layout.drawItemWords,
    binInstances: rt.layout.binInstances,
    drawRestBits: rt.layout.drawRestBits,
    hizTestedBounds: rt.layout.hizTestedBounds,
    hizTestedRows: rt.layout.hizTestedRows,
    hizTestedTriangles: rt.layout.hizTestedTriangles,
  };
};

const casItems = [
  {
    nom: '20 000 lignes, deux passes',
    entree: { count: LIGNES, twoPass: true, itemsDirty: true },
    taille: LIGNES,
  },
  {
    nom: '20 000 lignes, items inchangés',
    entree: { count: LIGNES, twoPass: true, itemsDirty: false },
    taille: LIGNES,
  },
  {
    nom: '20 000 lignes, une seule passe',
    entree: { count: LIGNES, twoPass: false, itemsDirty: true },
    taille: LIGNES,
  },
  { nom: 'une seule ligne', entree: { count: 1, twoPass: true, itemsDirty: true }, taille: 1 },
  { nom: 'aucune ligne', entree: { count: 0, twoPass: true, itemsDirty: true }, taille: 0 },
];

const lignes = [
  await compare({
    calcul: 'F6 ordre de la coupe transparente',
    fichier: 'packages/sdk-browser/webgpuBlendSelection.ts',
    cas: [
      { nom: 'coupe déjà ordonnée', entree: 'ordonnee', taille: 4000 },
      { nom: 'coupe presque ordonnée', entree: 'presque', taille: 4000 },
      { nom: 'coupe désordonnée', entree: 'desordonnee', taille: 4000 },
      { nom: 'clés NaN', entree: 'nan', taille: 400 },
      { nom: 'clés toutes égales', entree: 'identiques', taille: 2000 },
      { nom: 'un seul cluster', entree: 'seule', taille: 1 },
      { nom: 'coupe vide', entree: 'vide', taille: 0 },
    ],
    reference: passeCoupe(referenceOrdonneCoupe),
    optimisee: passeCoupe(ordonneCoupeTransparente),
    options: { tours: 200, budgetMs: 2500 },
  }),
  await compare({
    calcul: 'F7 items de visibilité et bornes Hi-Z',
    fichier: 'packages/sdk-browser/webgpuVisibilityItems.ts',
    cas: casItems,
    reference: passeItems(referenceBuildItems),
    optimisee: passeItems(buildWebgpuVisibilityItems),
    options: { chauffe: 10, tours: 200, budgetMs: 3000 },
  }),
];

verifieEtDeposeF(
  'f-transparents',
  'F6 et F7 rendent exactement le même ordre de coupe et les mêmes items',
  lignes,
);
