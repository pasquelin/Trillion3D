import type { PartitionFrame } from './uniform.ts';

/** A buffer of four bytes that only carries its label. */
export const buffer = (label: string) => ({ label, size: 4, destroy() {} }) as unknown as GPUBuffer;

/** A still frame of `rows` rows on an 8 by 8 view with one level. */
export const frame = (rows: number): PartitionFrame => ({
  view: new Float64Array(16),
  viewProj: new Float64Array(16),
  anchor: [0, 0, 0],
  near: 0.1,
  rows,
  width: 8,
  height: 8,
  levels: [{ offset: 0, width: 8 }],
  layerTop: 0,
  hasRest: true,
  viewMoved: false,
  counting: false,
});
