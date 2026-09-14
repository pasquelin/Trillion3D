import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';

/** Side of the test kernel, in texels of the mip it reads. A wider footprint answers from a coarser level. */
export const HIZ_KERNEL_TEXELS = 16;

/**
 * What one image's occlusion test did, counted in clusters and in the triangles those clusters carry.
 * `tested` is what the test was handed, `rejected` what it eliminated, `oversized` those whose level-0
 * screen footprint is wider than the test kernel and which therefore answer from a coarser mip. Every
 * field is a count of one image; nothing is deduced from another field.
 */
export type HizCounts = {
  tested: number;
  rejected: number;
  oversized: number;
  testedTriangles: number;
  rejectedTriangles: number;
  oversizedTriangles: number;
};

export function createHizCounts(): HizCounts {
  return {
    tested: 0,
    rejected: 0,
    oversized: 0,
    testedTriangles: 0,
    rejectedTriangles: 0,
    oversizedTriangles: 0,
  };
}

export function resetHizCounts(counts: HizCounts) {
  counts.tested = 0;
  counts.rejected = 0;
  counts.oversized = 0;
  counts.testedTriangles = 0;
  counts.rejectedTriangles = 0;
  counts.oversizedTriangles = 0;
}

/** A screen rectangle the level-0 kernel cannot cover. A near-plane crossing carries no rectangle. */
export function hizOversized(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  clipsNear: boolean,
) {
  return !clipsNear && (maxX - minX >= HIZ_KERNEL_TEXELS || maxY - minY >= HIZ_KERNEL_TEXELS);
}

/** `hizOversized` over the flat bounds layout `projectBoxesFlat` writes. */
export function hizOversizedFlat(bounds: Float64Array, base: number) {
  return hizOversized(
    bounds[base],
    bounds[base + 1],
    bounds[base + 2],
    bounds[base + 3],
    bounds[base + HIZ_BOUNDS_VALUES - 1] !== 0,
  );
}
