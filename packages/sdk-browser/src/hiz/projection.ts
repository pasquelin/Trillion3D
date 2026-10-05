import { HIZ_BOUNDS_VALUES, projectBoxInto, rowBox } from './corners.ts';
import type { HizPage } from './types.ts';
import type { EngineCamera } from '../camera/world.ts';
import { locationOf, type PageLocations } from '../page/selection/placements.ts';
import { IDENTITY_ELEMENTS } from '../math/matrixElements.ts';

export function projectBoxesFlat(
  pages: ArrayLike<HizPage | undefined>,
  locations: PageLocations,
  count: number,
  cam: EngineCamera,
  viewport: [number, number],
  into: Float64Array,
  only?: Uint8Array,
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
    const { min, max } = rowBox(page),
      base = i * HIZ_BOUNDS_VALUES;
    projectBoxInto(
      min,
      max,
      locationOf(locations, i).world,
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

/** Locations of pages placed by the identity root: what a staled box, already a world box, reads.
 *  Every index reads root 0, whatever the list's length. */
export const IDENTITY_LOCATIONS: PageLocations = {
  roots: [{ world: { elements: IDENTITY_ELEMENTS } }],
  packed: new Proxy([], { get: (_t, p) => (typeof p === 'symbol' ? undefined : 0) }),
  rootOfPacked: new Proxy([], { get: () => 0 }) as unknown as Int32Array,
};

let boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** Rectangles of a frame, in a buffer that grows only with the largest cut seen.
 *  One caller at a time: bounds do not outlive the pass that asked for them. */
export function boundsFor(count: number) {
  const need = Math.max(1, count) * HIZ_BOUNDS_VALUES;
  if (boundsScratch.length < need) boundsScratch = new Float64Array(need);
  return boundsScratch;
}
