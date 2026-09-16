import * as THREE from 'three';
import { matrixWindingCw } from '../sdk-core/index.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** Les trois pipelines de la passe, nommes par un rang : une entree de plan les choisit sans test. */
const PIPELINE_NONE = 0,
  PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;
/** Aucune primitive paginee derriere cet appel. */
const UNPAGED = 0xffffffff;

/** La puissance de deux qui separe deux items dans l'espace des indices de sommet. */
function shiftFor(maxVertexCount: number) {
  let shift = 1;
  while (shift < 30 && 1 << shift < Math.max(2, maxVertexCount)) shift++;
  return shift;
}

/** Le bord d'une boite, arrondi VERS L'EXTERIEUR en simple precision : la boite simple contient la
 *  boite double, si bien qu'un rejet sur l'une vaut rejet sur l'autre. */
const outward = (value: number, sign: number) =>
  Math.fround(value + sign * (Math.abs(value) * 2e-7 + 1e-30));

/**
 * Les tables statiques de la passe transparente : ce qu'un appel dessine, et ou son item se nomme.
 *
 * L'indice de sommet porte le rang de l'item dans ses bits hauts — le premier sommet de chaque
 * appel vaut `rang << itemShift` — et son rang local dans les bas. C'est ce qui permet a tous les
 * items pagines de partager UN groupe de liaison : le nuanceur retrouve la fiche de l'item sans que
 * l'encodage ait rien a lier entre deux appels.
 */
export function buildBlendStatics(blendState: BlendState) {
  const items = blendState.blendGpu,
    table = blendState.table;
  let maxVertexCount = 1;
  for (const item of items)
    maxVertexCount = Math.max(
      maxVertexCount,
      item.paged ? (table?.maxVertexWords ?? 0) : item.count,
    );
  const shift = shiftFor(maxVertexCount);
  blendState.itemShift = shift;
  const draws = new Uint32Array(Math.max(1, items.length) * 4);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.itemIndex = i;
    item.tableBase =
      item.paged && table && item.pagedIndex !== undefined
        ? table.itemRanges[item.pagedIndex * 2]
        : 0;
    draws[i * 4] = item.paged && item.pagedIndex !== undefined ? item.pagedIndex : UNPAGED;
    draws[i * 4 + 1] = item.paged ? (table?.maxVertexWords ?? 0) : item.count;
    draws[i * 4 + 2] = i << shift;
    draws[i * 4 + 3] = 0;
  }
  blendState.drawsPacked = draws;
  blendState.boxesPacked = new Float32Array(Math.max(1, items.length) * 8);
}

/** Les deux entrees de plan d'un item double face, dans l'ordre que la passe encodait : dos, face. */
function sidesOf(item: BlendState['blendGpu'][number]) {
  const material = Array.isArray(item.material) ? item.material[0] : item.material;
  // Un seul determinant : l'appel rendait deux fois la meme valeur pour choisir les deux faces.
  const renverse = matrixWindingCw(item.matrix.elements);
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT;
  if (material.side === THREE.DoubleSide && !material.forceSinglePass) return [back, front];
  if (material.side === THREE.FrontSide) return [front];
  if (material.side === THREE.BackSide) return [back];
  return [PIPELINE_NONE];
}

/**
 * Le plan d'encodage et les boites monde, refaits quand la scene a change de matrices — et jamais
 * par image. Une entree de plan porte le rang de l'item et le pipeline a poser, si bien que la
 * boucle d'encodage ne fait plus ni produit de matrice, ni lecture de materiau, ni allocation.
 */
export function refreshBlendPlan(blendState: BlendState) {
  const items = blendState.blendGpu,
    boxes = blendState.boxesPacked;
  const blend: number[] = [],
    transmission: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      into = item.transmissive ? transmission : blend;
    for (const side of sidesOf(item)) into.push(i * 4 + side);
    const base = i * 8,
      box = item.bounds;
    if (!box) {
      boxes.fill(0, base, base + 8);
      continue;
    }
    for (let axis = 0; axis < 3; axis++) {
      boxes[base + axis] = outward(box[axis], -1);
      boxes[base + 4 + axis] = outward(box[axis + 3], 1);
    }
    boxes[base + 3] = 1;
    boxes[base + 7] = 0;
  }
  blendState.planBlend = Uint32Array.from(blend);
  blendState.planTransmission = Uint32Array.from(transmission);
}
