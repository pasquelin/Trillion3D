import { boxIsEmpty, boxTransform } from '../sdk-core/index.ts';
import { readThreeBox } from './threeBounds.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/**
 * La boîte monde d'un item transparent, refaite depuis la boîte LOCALE de sa géométrie et la
 * matrice qu'il porte — celle du maillage source, jamais une photo. Rien n'est cuit à la
 * préparation : la même fonction pose la boîte de la première image et celle qui suit un
 * déplacement, si bien qu'une boîte ne peut pas décrire un autre placement que le dessin.
 *
 * `worldBox` est allouée une fois pour l'item et ne l'est jamais par image. Une boîte vide ou non
 * finie retire `bounds` : sans boîte, le tronc ne rejette jamais l'item — un transparent ne devient
 * pas invisible parce que ses bornes sont douteuses.
 */
export function refreshBlendBounds(item: BlendGpuItem) {
  const box = item.worldBox;
  if (!box) return;
  const local = item.sourceGeometry.boundingBox;
  if (!local) {
    item.bounds = undefined;
    return;
  }
  readThreeBox(box, local);
  boxTransform(box, 0, box, 0, item.matrix.elements);
  item.bounds = !boxIsEmpty(box, 0) && box.every(Number.isFinite) ? box : undefined;
}

/**
 * Les boîtes monde de la liste transparente, reprises quand la scène a changé de matrices. Les
 * matrices elles-mêmes ne sont pas reprises : chaque item lit déjà celle de son maillage source.
 * Rend le nombre d'items dont la boîte a été refaite.
 */
export function refreshBlendWorlds(items: readonly BlendGpuItem[]) {
  let repris = 0;
  for (const item of items)
    if (item.worldBox) {
      refreshBlendBounds(item);
      repris++;
    }
  return repris;
}
