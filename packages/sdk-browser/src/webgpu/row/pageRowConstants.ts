import { clusterHash } from '../../visibility/buffer.ts';
import { wrapModes } from '../../visibility/wrapModes.ts';
import { refreshSurface, type PageSurface } from '../../page/surface.ts';
import { hostAddressings } from '../../host/surfaceImport.ts';

/** What a material brings to a page row: its read fields, and its wrap word. */
type MaterialRow = { version: number; addressings: number; mat: PageSurface; wrap: number };

/**
 * What writing a page row used to recompute every time even though it depends only on the compiled
 * catalogue: the material fields — a new object and four arrays per write —, its wrap word and the
 * cluster hash — a code-point array per write.
 *
 * Twelve placements of the same scene share their materials and clusters: one memo per surface
 * record and one per cluster id is enough to compute them once and for all, however many pages
 * arrive in the image. A memo is reread when the host bumps the declaration's version, the only
 * mutation the engine honours — the record itself is refilled in place (`../../page/surface.ts`) —,
 * and its wrap word when a map's addressing moved without it (`hostAddressings`).
 */
export function createPageRowConstants() {
  const materials = new Map<PageSurface, MaterialRow>();
  const hashes = new Map<string, number>();
  return {
    /** Fields and wrap word of a surface, computed at its first row. */
    materialOf(surface: PageSurface) {
      const mat = refreshSurface(surface);
      const held = materials.get(mat);
      const addressings = hostAddressings();
      if (held && held.version === mat.version && held.addressings === addressings) return held;
      const row = { version: mat.version, addressings, mat, wrap: wrapModes(mat) };
      materials.set(mat, row);
      return row;
    },
    /** Hash of a cluster id, computed at its first row. */
    hashOf(clusterId: string) {
      const held = hashes.get(clusterId);
      if (held !== undefined) return held;
      const hash = clusterHash(clusterId);
      hashes.set(clusterId, hash);
      return hash;
    },
  };
}
