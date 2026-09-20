import { SHADOW_CULL_FLOATS } from '../sdk-core/index.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

/** Floats of a cluster world sphere in the packed list: centre then radius. */
const SPHERE_FLOATS = 4;

/** The cull's own test, on one sphere against one region volume (`gpuShadowCullShader.ts`). */
function kept(volumes: Float32Array, base: number, spheres: Float32Array, at: number) {
  const dx = spheres[at] - volumes[base],
    dy = spheres[at + 1] - volumes[base + 1],
    dz = spheres[at + 2] - volumes[base + 2],
    radius = spheres[at + 3];
  if (volumes[base + 7] < 0) {
    // A box: distance from the sphere centre to the box, in the frame of the face — right and
    // up with their half-extents beside them, the face axis with the half-depth in `far`.
    let gap = 0;
    for (let axis = 0; axis < 3; axis++) {
      const a = base + (axis === 0 ? 8 : axis === 1 ? 12 : 4),
        half = axis === 2 ? volumes[base + 3] : volumes[a + 3];
      const local = Math.abs(dx * volumes[a] + dy * volumes[a + 1] + dz * volumes[a + 2]);
      const beyond = Math.max(local - half, 0);
      gap += beyond * beyond;
    }
    return gap <= radius * radius;
  }
  const distance = Math.hypot(dx, dy, dz);
  if (distance - radius > volumes[base + 3]) return false;
  if (volumes[base + 7] >= 3.14159 || distance <= radius) return true;
  const cosine =
    (dx * volumes[base + 4] + dy * volumes[base + 5] + dz * volumes[base + 6]) / distance;
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  return angle - Math.asin(Math.min(1, radius / distance)) <= volumes[base + 7];
}

/** What the last frame's shadow cull tested and kept, replayed on the host. */
export const shadowOccluders = { tested: 0, kept: 0 };

/**
 * Replays the region cull of the frame on the host, over the resident rows: how many cluster
 * spheres each region volume tested, and how many it kept for the depth pass. A diagnostic
 * count for the profile, never read by the frame — the GPU cull tests the compacted instance
 * list, a subset of these rows, so the host count is an upper bound of what was drawn.
 */
export function countShadowOccluders(lights: WebgpuLightState, rows: number) {
  const { cull, spheres } = lights,
    regions = lights.shadowRegions;
  shadowOccluders.tested = 0;
  shadowOccluders.kept = 0;
  if (!cull || !spheres || !regions) return shadowOccluders;
  const count = Math.min(rows, spheres.rows);
  for (let region = 0; region < regions; region++) {
    const base = region * SHADOW_CULL_FLOATS;
    for (let row = 0; row < count; row++) {
      const at = row * SPHERE_FLOATS;
      if (spheres.packed[at + 3] <= 0) continue;
      shadowOccluders.tested++;
      if (kept(cull.volumes, base, spheres.packed, at)) shadowOccluders.kept++;
    }
  }
  return shadowOccluders;
}
