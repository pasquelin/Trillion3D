/**
 * MEASUREMENT EXPERIMENT, never a production path: the cluster screen-error metric,
 * switchable between ours and that of the external reference. Branch `calculs/exp-erreur-ecran`.
 *
 * `certifiee` (default): `screenErrorBound` of `screenErrorBound.ts`, a certified majorant of
 * screen displacement — near plane, off-axis lateral offset, anisotropic stretch included.
 *
 * `reference`: the simple projection of the cluster error sphere, as the external
 * reference publishes it — a cluster's object error divided by its distance to the camera, multiplied
 * by the projection factor, i.e.
 *
 *     error_pixels ≈ object_error × screen_height / (2 × distance × tan(fov/2))
 *
 * where `screen_height / (2 × tan(fov/2))` is exactly the focal length in pixels `focal` that the
 * engine already passes to both metrics, and `distance` the view depth of the sphere centre. No
 * lateral term, no bounding radius, no displacement in the denominator, a near-plane
 * guard and nothing else.
 *
 * A cluster's error is stored in its primitive's units, distance is read in view
 * units: `stretch` therefore stays as a factor, it only converts one into the other. Without
 * it the comparison would measure the scene scale and not the metric's shape — checked:
 * on the bench scene the scale is well under 1, and omitting it inverted the verdict. For
 * a conformal transform `maxStretch` is exactly that uniform scale; it is only
 * off conformal that the anisotropic term still separates the two metrics.
 *
 * Public source of the formula: B. Karis, R. Stubbe and G. Wihlidal, presentation of the external
 * reference on virtualized geometry, course "Advances in Real-Time Rendering in Games",
 * SIGGRAPH 2021 — section on level-of-detail choice, where a cluster's simplification error
 * is projected in pixels and compared to a threshold on the order of a pixel.
 *
 * The switch is module state, read by the CPU metric (`screenErrorBound`, hence
 * everything that descends from it) and by the WGSL text when the selection shader is compiled.
 * Each side of the bench runs in its own page: module state is enough to separate them.
 */

import { clipWeight } from '../math/primitives/camera.ts';
export type ScreenErrorVariant = 'certifiee' | 'reference';

let current: ScreenErrorVariant = 'certifiee';

/** Sets the variant for the whole page. `null`/`undefined` restores ours: no session inherits. */
export function setScreenErrorVariant(variant: ScreenErrorVariant | null | undefined): void {
  if (variant != null && variant !== 'certifiee' && variant !== 'reference')
    throw new Error('Unknown screen-error variant');
  current = variant ?? 'certifiee';
}

/** The variant in force. */
export function screenErrorVariant(): ScreenErrorVariant {
  return current;
}

/**
 * Screen error of the external reference: `(error × stretch) × focal / w`, infinity when the
 * centre does not reach the near plane; `w` is the clip weight of the centre's depth, the depth
 * itself under a perspective projection (`perspective` = 1) and 1 under an orthographic one (0,
 * `screenErrorBound.ts`). WGSL mirror in `packages/sdk-browser/src/gpu/dag/shader/shaderError.ts`, same operands and same order,
 * to f32. The caller has already handled a zero or infinite error.
 */
export function referenceScreenError(
  error: number,
  stretch: number,
  depth: number,
  focal: number,
  near: number,
  perspective = 1,
): number {
  const w = clipWeight(perspective, depth);
  if (!(w > perspective * near)) return Infinity;
  const shift = error * stretch;
  return (shift * focal) / w;
}
