import { lightDirection, type SceneLight, type ShadowViewpoint } from './sceneLightContracts.ts';
import type { createShadowChanges } from './sceneLightShadowChanges.ts';
import { writeFace } from './sceneLightShadowFaces.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';

/** Matrix of a face, the time to project a box: allocated once, never per frame. */
const matrix = new Float32Array(16);

/**
 * What stales the pages of a shadow light, and nothing more.
 *
 * - **The light has moved, changed range or slice**: all its maps are wrong, all
 *   their pages go back to waiting.
 * - **A sun cascade describes another world extent**: that cascade restarts in full.
 *   As long as the extent is the same — still camera, or a move smaller than a texel of the
 *   alignment grid —, the map is kept as-is, even if the camera has moved.
 * - **An object has moved in the light's range**: only the pages its projected box covers
 *   restart. The rest of the face still describes the scene, since nothing else has changed.
 */
export function invalidateLightPages(
  slices: ReturnType<typeof createShadowSliceTable>,
  changes: ReturnType<typeof createShadowChanges>,
  light: SceneLight,
  slice: number,
  faceCount: number,
  side: number,
  lightRevision: number,
  view: ShadowViewpoint,
  nowMs: number,
  frame: number,
  byPage: boolean,
) {
  const { dirty } = slices;
  const rows = pageRowsOf(side);
  const whole = !slices.noted[slice] || slices.revision[slice] !== lightRevision;
  const sun = light.kind === 'directional';
  const range = sun ? 0 : (light.range ?? 0);
  const x = light.position?.[0] ?? 0,
    y = light.position?.[1] ?? 0,
    z = light.position?.[2] ?? 0;
  for (let face = 0; face < faceCount; face++) {
    let all = whole;
    if (sun) {
      const cascade = sunCascadeOf(view, lightDirection(light), face, side);
      if (slices.cascadeChanged(slice, face, cascade.center, cascade.radius)) all = true;
    }
    if (all) {
      dirty.whole(slice, face, rows, nowMs, frame);
      continue;
    }
    let ready = false;
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, x, y, z, range)) continue;
      // Without per-page invalidation the whole face restarts: that is the behaviour from before
      // the batch, kept so the identity proof compares the same engine twice.
      if (!byPage) {
        dirty.whole(slice, face, rows, nowMs, frame);
        break;
      }
      if (!ready) {
        writeFace(matrix, 0, null, 0, light, face, view, side);
        ready = true;
      }
      const moved = changes.read(box);
      dirty.box(slice, face, rows, matrix, 0, moved.min, moved.max, nowMs, frame);
    }
  }
  slices.noteRevision(slice, lightRevision);
}
