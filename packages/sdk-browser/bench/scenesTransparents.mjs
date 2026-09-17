// La scène du banc « transparents en quelques ordres » et ses images : douze placements par
// prototype paginé, quelques primitives qui portent leurs propres tampons, et trois régimes de
// caméra. Les deux côtés du banc en bâtissent chacun un exemplaire, pour qu'aucun ne profite de
// l'état que l'autre laisse.
import * as THREE from 'three';
import { createWebgpuBlendState } from '../webgpuBlendState.ts';
import { buildBlendStatics, refreshBlendPlan } from '../webgpuBlendPlan.ts';
import { graine } from '../../sdk-core/bench/banc.mjs';
import { planReference } from './oracles/transparents-ordres.mjs';

/** L'ordre de grandeur de la scène mesurée : 4 288 items transparents, douze placements chacun. */
const PLACEMENTS = 12,
  PROTOTYPES = 357,
  ISOLES = 4,
  PAGINES = PROTOTYPES * PLACEMENTS;
export const ITEMS = PAGINES + ISOLES;
/** Ce qu'une primitive paginée tient au catalogue, et les sommets d'une grappe. */
const GRAPPES = 8,
  MOTS = 48;

const alea = graine(31);

/**
 * Les deux faces d'une scène transparente, et pourquoi le banc mesure les deux.
 *
 * `sidesOf` rend UNE entrée de plan pour un matériau simple face, et DEUX — dos puis face, deux
 * pipelines — pour un matériau double face. Or une tranche s'arrête quand le pipeline change : une
 * scène double face, le verre et le feuillage d'une scène glTF ordinaire, n'en fusionne donc
 * aucune. Mesurer la seule scène simple face, c'est mesurer le meilleur cas et le publier comme s'il
 * était le cas.
 */
export const FACES = [
  ['simple face', THREE.FrontSide],
  ['double face', THREE.DoubleSide],
];

/** La scène : douze placements par prototype, plus quatre primitives qui portent leurs tampons. */
function batisItems(side) {
  const items = [],
    materiau = new THREE.MeshBasicMaterial({ side });
  for (let i = 0; i < ITEMS; i++) {
    const paged = i < PAGINES;
    const matrix = new THREE.Matrix4().setPosition(
      (i % 64) * 3 - 96,
      ((i >> 6) % 16) * 4,
      Math.floor(i / 1024) * 5,
    );
    const m = matrix.elements;
    const bounds = new Float64Array([
      m[12] - 1,
      m[13] - 1,
      m[14] - 1,
      m[12] + 1,
      m[13] + 1,
      m[14] + 1,
    ]);
    items.push({
      material: materiau,
      matrix,
      bounds,
      count: paged ? 0 : 900,
      paged,
      pagedIndex: paged ? i : undefined,
      tableBase: paged ? i * GRAPPES : 0,
    });
  }
  return items;
}

/** Les six demi-espaces d'une boîte centrée sur l'œil : la règle du tronc, sans projection. */
function plansDe(x) {
  const planes = new Float64Array(24);
  const pose = (p, a, b, c, d) => {
    planes[p * 4] = a;
    planes[p * 4 + 1] = b;
    planes[p * 4 + 2] = c;
    planes[p * 4 + 3] = d;
  };
  pose(0, 1, 0, 0, 110 - x);
  pose(1, -1, 0, 0, 110 + x);
  pose(2, 0, 1, 0, 40);
  pose(3, 0, -1, 0, 40);
  pose(4, 0, 0, 1, 400);
  pose(5, 0, 0, -1, 400);
  return planes;
}

/** Une image : l'œil, ses plans, et la coupe que la compaction aurait écrite pour chaque item. */
function imageA(x) {
  const counts = new Uint32Array(PAGINES),
    instances = new Uint32Array(PAGINES * GRAPPES);
  for (let p = 0; p < counts.length; p++) {
    const tenues = 1 + Math.floor(alea() * GRAPPES);
    counts[p] = tenues;
    for (let j = 0; j < tenues; j++) instances[p * GRAPPES + j] = p * GRAPPES + j;
  }
  return { eye: [x, 8, 0], planes: plansDe(x), counts, instances };
}

/**
 * Trois régimes, huit images chacun : la caméra qui glisse — l'aller-retour referme la boucle, si
 * bien qu'un tour n'enchaîne pas sur un saut déguisé —, la pose immobile, et le saut de caméra,
 * qui renouvelle entièrement l'ordre de peinture.
 */
export const glisse = [0, 6, 12, 18, 24, 18, 12, 6].map(imageA);
export const regimes = [
  ['caméra qui glisse', glisse],
  ['pose immobile', Array.from({ length: 8 }, () => glisse[0])],
  ['saut de caméra', Array.from({ length: 8 }, (_, image) => imageA(image * 47 - 160))],
];

/** La portée de chaque grappe dans le cache de pages : la même table des deux côtés. */
export const spans = new Uint32Array(PAGINES * GRAPPES * 2);
for (let e = 0; e < spans.length / 2; e++) {
  spans[e * 2] = e * MOTS;
  spans[e * 2 + 1] = MOTS;
}

/** Un côté du banc : son état de mélange, son plan à l'ancien format, et ses tampons de sortie. */
export function cote(side) {
  const blendState = createWebgpuBlendState();
  blendState.blendGpu.push(...batisItems(side));
  blendState.table = {
    maxVertexWords: MOTS,
    capacity: PAGINES * GRAPPES,
    length: PAGINES * GRAPPES,
    itemRanges: Uint32Array.from({ length: PAGINES * 2 }, (_, k) =>
      k % 2 ? GRAPPES : (k >> 1) * GRAPPES,
    ),
  };
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  return {
    blendState,
    // Le plan du chemin d'avant, à son propre format : le lot a mis le bit de partage dans l'entrée.
    order: planReference(blendState.blendGpu),
    scene: {
      items: blendState.blendGpu,
      draws: blendState.drawsPacked,
      planes: blendState.blendPlanes,
      spans,
      itemCounts: undefined,
      instances: undefined,
    },
    args: new Uint32Array(ITEMS * 4),
    // Un item double face étale ses instances deux fois : une par entrée de plan.
    sortie: new Uint32Array((PAGINES * GRAPPES + ISOLES) * 3 * 2),
  };
}

/** Ce que l'image donne aux deux côtés : les plans du tronc et la coupe de cette image-ci. */
export function pose(etat, image) {
  etat.blendState.blendPlanes.set(image.planes);
  etat.scene.itemCounts = image.counts;
  etat.scene.instances = image.instances;
  etat.blendState.cpuItemCounts = image.counts;
  etat.blendState.cpuInstances = image.instances;
}
