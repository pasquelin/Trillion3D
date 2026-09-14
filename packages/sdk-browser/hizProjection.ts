import * as THREE from 'three';
import {
  HIZ_BOUNDS_VALUES,
  projectCornersInto,
  projectBoxInto,
  type BoxCorners,
} from './hizCorners.ts';
import type { HizBounds, HizPage } from './hizTypes.ts';

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

const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** Conservative screen AABB. min/max are inclusive integer samples (fillIds last pixel is ceil(max)). Near-plane crossings never reject. */
export function projectBoxToScreen(
  min: number[],
  max: number[],
  world: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
): HizBounds {
  camera.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  projectBoxInto(
    min,
    max,
    world,
    camera.matrixWorldInverse.elements,
    viewProj.elements,
    camera.near,
    viewport[0],
    viewport[1],
    boundsScratch,
    0,
  );
  const b = boundsScratch;
  if (b[5] !== 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, nearestDepth: 0, clipsNear: true };
  return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], nearestDepth: b[4], clipsNear: false };
}
