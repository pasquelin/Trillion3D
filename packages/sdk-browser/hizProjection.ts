import {
  HIZ_BOUNDS_VALUES,
  projectCornersInto,
  projectBoxInto,
  type BoxCorners,
} from './hizCorners.ts';
import type { HizPage } from './hizTypes.ts';
import type { EngineCamera } from './cameraWorld.ts';

export function projectBoxesFlat(
  pages: ArrayLike<HizPage | undefined>,
  count: number,
  cam: EngineCamera,
  viewport: [number, number],
  into: Float64Array,
  only?: Uint8Array,
  world?: { corners: BoxCorners; pageIndex: Int32Array; epoch: number },
) {
  const [width, height] = viewport;
  // View, view-projection and near plane come from the engine camera: a frame sets them once.
  const view = cam.view,
    elements = cam.viewProjection,
    near = cam.near;
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
/** Rectangles of a frame, in a buffer that grows only with the largest cut seen.
 *  One caller at a time: bounds do not outlive the pass that asked for them. */
export function boundsFor(count: number) {
  const need = Math.max(1, count) * HIZ_BOUNDS_VALUES;
  if (boundsScratch.length < need) boundsScratch = new Float64Array(need);
  return boundsScratch;
}
