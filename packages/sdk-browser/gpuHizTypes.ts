import type { HizCounts } from './hiz.ts';
import type { HizCountSample } from './gpuHizCounters.ts';

export type GpuHiz = {
  width: number;
  height: number;
  level0: GPUTexture;
  level0View: GPUTextureView;
  flags: GPUBuffer;
  encodePyramid(encoder: GPUCommandEncoder): void;
  /**
   * Tests `count` boxes from the flat layout `projectBoxesFlat` writes; `rows[i]` names the `flags`
   * entry box `i` answers for. `flagRows` entries are cleared first, so a row this frame does not test
   * reads 0 instead of the verdict of an earlier frame.
   */
  encodeTest(
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    bounds: Float64Array,
    rows: Uint32Array,
    count: number,
    flagRows: number,
    sample?: HizCountSample,
  ): number;
  /**
   * Hands the verdicts of the sampled image to the mapping. Called once the image that `encodeTest`
   * encoded the copy into has been submitted: a mapping requested before the submission would make
   * that submission use a mapped buffer. A no-op on every image that encoded no copy.
   */
  countsSubmitted(): void;
  /**
   * Counts of the last image whose verdicts came back, and the number of that image. Undefined until
   * one has: nothing here is deduced, and a device that cannot map a buffer never reports counts.
   */
  counts(): (HizCounts & { frame: number }) | undefined;
  resize(device: GPUDevice, width: number, height: number): boolean;
  dispose(): void;
};
