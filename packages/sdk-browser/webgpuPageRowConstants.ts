import { clusterHash, visMaterial } from './visibilityBuffer.ts';
import { wrapModes } from './visibilityWrapModes.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** Material as the row receives it from the host: the type `visMaterial` already accepts. */
type HostMaterial = Parameters<typeof visMaterial>[0];

/** What a material brings to a page row: its read fields, and its wrap word. */
type MaterialRow = { version: number; mat: VisMaterial; wrap: number };

/**
 * What writing a page row used to recompute every time even though it depends only on the compiled
 * catalogue: the material fields — a new object and four arrays per write —, its wrap word and the
 * cluster hash — a code-point array per write.
 *
 * Twelve placements of the same scene share their materials and clusters: one memo per material and
 * one per cluster id is enough to compute them once and for all, however many pages arrive in the
 * image. A material memo is reread when Three changes its version, the only mutation the engine
 * applies to it.
 */
export function createPageRowConstants() {
  const materials = new Map<HostMaterial, MaterialRow>();
  const hashes = new Map<string, number>();
  return {
    /** Fields and wrap word of a material, computed at its first row. */
    materialOf(material: HostMaterial) {
      const version = (Array.isArray(material) ? material[0] : material).version;
      const held = materials.get(material);
      if (held && held.version === version) return held;
      const mat = visMaterial(material);
      const row = { version, mat, wrap: wrapModes(mat) };
      materials.set(material, row);
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
