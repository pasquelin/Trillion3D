import * as THREE from 'three';
import {
  HIZ_BOUNDS_VALUES,
  projectCornersInto,
  projectBoxInto,
  type BoxCorners,
} from './hizCorners.ts';
import type { HizPage } from './hizTypes.ts';

const viewProjScratch = new THREE.Matrix4();

export function projectBoxesFlat(
  pages: ArrayLike<HizPage | undefined>,
  count: number,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  into: Float64Array,
  only?: Uint8Array,
  world?: { corners: BoxCorners; pageIndex: Int32Array; epoch: number },
) {
  const [width, height] = viewport;
  camera.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const view = camera.matrixWorldInverse.elements,
    elements = viewProj.elements,
    near = camera.near;
  for (let i = 0; i < count; i++) {
    if (only && !only[i]) continue;
    const page = pages[i];
    if (!page) continue;
    const base = i * HIZ_BOUNDS_VALUES;
    if (world)
      projectCornersInto(
        world.corners.corners,
        world.corners.at(world.pageIndex[i], page, world.epoch),
        view,
        elements,
        near,
        width,
        height,
        into,
        base,
      );
    else
      projectBoxInto(
        page.min,
        page.max,
        page.matrix,
        view,
        elements,
        near,
        width,
        height,
        into,
        base,
      );
  }
}

let boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** Les rectangles d'une image, dans un tampon qui ne grandit qu'avec la plus grosse coupe vue.
 *  Un seul appelant à la fois : les bornes ne survivent pas à la passe qui les a demandées. */
export function boundsFor(count: number) {
  const need = Math.max(1, count) * HIZ_BOUNDS_VALUES;
  if (boundsScratch.length < need) boundsScratch = new Float64Array(need);
  return boundsScratch;
}
