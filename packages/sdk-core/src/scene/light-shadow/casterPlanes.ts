import { LIGHT_KIND, SCENE_LIGHT_FLOATS, SCENE_LIGHT_HEADER_FLOATS } from '../light/contracts.ts';
import { LIGHT_FIELD, type SceneLightStore } from '../light/store.ts';
import { castsShadow } from './casters.ts';

/** Six planes, four numbers each: `n · x + d ≥ 0` inside, as every frustum of the engine. */
const PLANES = 6;

/**
 * The frustum planes a cut must stop rejecting with, one bit each, so that it keeps the geometry
 * that can shade what it shows. A caster outside the view still darkens a surface inside it; a
 * cut that drops it leaves that surface lit, and shadow maps drawn from the cut leak light the
 * moment it is out of view.
 *
 * What can shade the view lies in the convex hull of the frustum and the light: the frustum
 * swept toward the sun, or joined to a lamp's position. A frustum plane still bounds that hull
 * when the light is on its inner side, and only then may it reject a box. Every light that
 * declares a shadow is honoured at once: a plane stays only if it bounds all their hulls, and
 * with none the mask is zero. A lamp is taken at its position, the point its own map is drawn
 * from. Which side a point lies on does not depend on the frame, so the mask read on one frame's
 * planes holds for the same planes carried into any other.
 *
 * `origin` is where the planes' frame sits in the world: a render frame centred on the camera
 * gives its eye, a world frame zero.
 */
export function shadowCasterPlanes(
  planes: ArrayLike<number>,
  store: SceneLightStore,
  origin: ArrayLike<number>,
) {
  const { packed } = store;
  let open = 0;
  for (let slot = 0; slot < store.count; slot++) {
    if (!castsShadow(store, slot)) continue;
    const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
    const sun = packed[base + LIGHT_FIELD.kind] === LIGHT_KIND.directional;
    // The sun as a point at infinity, toward it; a lamp as its position in the planes' frame.
    const at = sun ? LIGHT_FIELD.direction : LIGHT_FIELD.position,
      sign = sun ? -1 : 1,
      w = sun ? 0 : 1;
    for (let plane = 0; plane < PLANES; plane++) {
      const o = plane * 4;
      let side = planes[o + 3] * w;
      for (let axis = 0; axis < 3; axis++)
        side += planes[o + axis] * (sign * packed[base + at + axis] - w * origin[axis]);
      if (side < 0) open |= 1 << plane;
    }
  }
  return open;
}

/** Makes the planes of `open` neutral, `(0, 0, 0, 1)`: they reject nothing, in any frame. */
export function openPlanes(planes: Float32Array | Float64Array, open: number) {
  for (let plane = 0; plane < PLANES; plane++) {
    if (!(open & (1 << plane))) continue;
    planes.fill(0, plane * 4, plane * 4 + 3);
    planes[plane * 4 + 3] = 1;
  }
}
