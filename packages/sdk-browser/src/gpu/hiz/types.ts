import type { PendingGrowth } from '../core/tableGrowth.ts';

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
  /** Verdict flags for `rows` rows, made now and put in place by `commit`: the pyramids stay. */
  growFlags(rows: number): PendingGrowth;
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
   * instead of a previous frame's verdict. `pages` is the page table: a row whose Hi-Z slot is
   * none (never culled) is kept and counts no reject.
   */
  encodeTest(
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    maxRows: number,
    flagRows: number,
    pages: GPUBuffer,
  ): number;
  resize(device: GPUDevice, width: number, height: number): boolean;
  /**
   * The `width × height` this image draws in the top-left of level 0, at most its size: the build,
   * the test and `levels()` read that, so a render-scale change remakes nothing. Level 0 is
   * cleared to the far plane beyond it, which never occludes.
   */
  extent(width: number, height: number): void;
  /**
   * Installs `next` — a view's own pyramid, or none yet — and returns the one in place: the Hi-Z
   * half of a view switch, with no allocation and no device round trip. Without one, `width` and
   * `height` are 0 until `resize` makes the drawn view's own.
   */
  swap(next: HizPyramid | undefined): HizPyramid | undefined;
  dispose(): void;
};

/** One view's pyramid, at that view's size, held by the view while another is drawn. */
export type HizPyramid = { readonly width: number; readonly height: number; destroy(): void };
