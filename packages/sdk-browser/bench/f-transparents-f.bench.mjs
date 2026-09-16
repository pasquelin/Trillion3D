// F7 : les items de visibilité. L'enregistrement de la ligne est lu une fois au lieu de trois, et la
// borne de couche sort de la boucle.
//
// F6 mesurait l'ordre de la coupe transparente processeur. Ce calcul n'existe plus : la sélection GPU
// des transparents a supprimé la coupe processeur et son tri par image, et l'ordre de dessin est
// devenu une table statique filtrée par une compaction GPU. Le constat « déjà ordonné, donc pas de
// tri » du lot F vit maintenant dans le repli processeur de `webgpuBlendSelection.ts`.
import * as THREE from 'three';
import { buildWebgpuVisibilityItems } from '../webgpuVisibilityItems.ts';
import { HIZ_BOUNDS_VALUES } from '../hiz.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from '../gpuDraw.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeF } from '../../sdk-core/bench/bancF.mjs';
import { referenceBuildItems } from './oracles/f-transparents.mjs';

const alea = graine(787);
const materiaux = [
  new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
];

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
    calcul: 'F7 items de visibilité et bornes Hi-Z',
    fichier: 'packages/sdk-browser/webgpuVisibilityItems.ts',
    cas: casItems,
    reference: passeItems(referenceBuildItems),
    optimisee: passeItems((rt, twoPass, itemsDirty) =>
      buildWebgpuVisibilityItems(rt, itemsDirty, { twoPass }),
    ),
    options: { chauffe: 10, tours: 200, budgetMs: 3000 },
  }),
];

verifieEtDeposeF('f-transparents', 'F7 rend exactement les mêmes items de visibilité', lignes);
