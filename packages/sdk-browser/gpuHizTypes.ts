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
  ): number;
  resize(device: GPUDevice, width: number, height: number): boolean;
  dispose(): void;
};
