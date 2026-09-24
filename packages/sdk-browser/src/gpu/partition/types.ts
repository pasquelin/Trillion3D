import type { PartitionFrame } from './uniform.ts';
import type { PartitionCountsFrame } from './counters.ts';

/** Buffers the partition uses but does not own: those of the draw compact, the Hi-Z test's
 *  verdict buffer, which it rereads to feed the occluder history, and the pyramid the previous
 *  image left, which its main-pass cull reads. The pyramid is asked for on every image because
 *  a target resize gives it a new identity; `undefined` once the Hi-Z is gone. */
export type PartitionSources = {
  items: GPUBuffer;
  flags: GPUBuffer;
  restBits: GPUBuffer;
  slotUsed: GPUBuffer;
  pyramid: () => GPUBuffer | undefined;
};

/** What the last frame sent the kernel, copied: the exact input of its projection. */
export type KeptFrame = {
  rows: number;
  width: number;
  height: number;
  near: number;
  view: Float64Array;
  viewProj: Float64Array;
};

export type GpuPartition = {
  /** Input of the last encoded frame, or `undefined` before the first. */
  readonly lastFrame: KeptFrame | undefined;
  /** Reads back the words the kernel wrote for `rows` rows; `undefined` if the device does not
   *  map. This is not a frame pass: it allocates, copies, then returns its buffer. */
  readRowData(rows: number): Promise<Uint32Array | undefined>;
  /** World corners per row, written by the caller on the table's dirty range. */
  corners: GPUBuffer;
  /** Bounds of the tested half, already packed for the occlusion kernel. */
  tested: GPUBuffer;
  /** Frame counters and its split decision; the occlusion kernel reads its count there. */
  state: GPUBuffer;
  /** Screen rectangle and depth bound of each row, as the kernel wrote them. */
  rowData: GPUBuffer;
  /** Frame input as `encode` wrote it: anchored matrices, near plane, target size and mip
   *  table. The transparent occlusion test reads this SAME buffer, so both projections of the
   *  frame share the arithmetic and not only the rule. */
  uniforms: GPUBuffer;
  uploadCorners(packed: Float32Array, from: number, to: number): void;
  /** Rows `[from, to]` the table rewrote: what they held — rectangle, verdict, kept flag —
   *  described the page or the place that left, and the next image reads them as never projected.
   *  Called once per run: rows scattered across the table forget nothing between them. */
  forgetRows(from: number, to: number): void;
  encode(encoder: GPUCommandEncoder, frame: PartitionFrame): void;
  /** True when the periodic-sample interval has elapsed and none is in flight. */
  countsDue(frame: number): boolean;
  /** Encodes the copy of the counters this frame just wrote. */
  encodeCounts(encoder: GPUCommandEncoder, frame: number): void;
  /** Requests mapping of the encoded copy, once the frame is submitted. */
  countsSubmitted(): void;
  /** What the last sampled frame decided and counted, or `undefined` before the first sample. */
  counts(): PartitionCountsFrame | undefined;
  dispose(): void;
};
