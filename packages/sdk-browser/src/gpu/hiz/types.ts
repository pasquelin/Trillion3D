export type GpuHiz = {
  width: number;
  height: number;
  level0: GPUTexture;
  level0View: GPUTextureView;
  flags: GPUBuffer;
  encodePyramid(encoder: GPUCommandEncoder): void;
  /**
   * Adopts the tested boxes and the frame state the GPU partition writes. It is mounted after the
   * pyramid — it reads `flags` — so the bind group only knows them here. Without this call,
   * `encodeTest` encodes nothing: no row is then tested, so none is rejected.
   */
  attach(bounds: GPUBuffer, state: GPUBuffer): void;
  /** Pyramid mips, offset and width: what the partition reads to express a screen
   *  rectangle in texels of the mip that covers it exactly. */
  levels(): Array<{ offset: number; width: number }>;
  /** The pyramid buffer itself, which the transparent occlusion test walks with
   *  the `levels()` table. It changes identity on every target resize. */
  pyramidBuffer(): GPUBuffer | undefined;
  /**
   * Tests the boxes the partition compacted; their count lives in the state, and the CPU does not
   * read it. `maxRows` bounds the dispatch — any drawable row may have been tested — and
   * `flagRows` verdict entries are cleared first, so a row this frame does not test reads 0
   * instead of a previous frame's verdict.
   */
  encodeTest(
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    maxRows: number,
    flagRows: number,
  ): number;
  resize(device: GPUDevice, width: number, height: number): boolean;
  dispose(): void;
};
