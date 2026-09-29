import { createWaterDepthRestore } from './depthRestore.ts';
import type { WaterBounds } from './bounds.ts';

/**
 * The backdrop freeze of the water pass: the lit image copied within the refraction reach, the
 * opaque depth copied into the depth the surface stage tests. WebGPU copies a depth texture only
 * whole: under a partial surface rectangle the depth is restored texel by texel within it
 * (`depthRestore.ts`). Without active bounds (`bounds.ts`), both cover the full target.
 * The descriptors are the frame's, rewritten in place: a frame allocates nothing.
 */
export async function createWaterFreeze(device: GPUDevice) {
  const restore = await createWaterDepthRestore(device);
  const origin = { x: 0, y: 0 },
    size = { width: 1, height: 1 },
    extent = { width: 1, height: 1 },
    full = new Float64Array(4);
  const from = { texture: undefined as unknown as GPUTexture, origin },
    color = { texture: undefined as unknown as GPUTexture, origin },
    depth = { texture: undefined as unknown as GPUTexture },
    waterDepth = { texture: undefined as unknown as GPUTexture };
  const freeze = {
    /** The target's size, the whole-target rectangle of an image without bounds. */
    extent,
    /** Whether the last freeze drew the depth restore pass. */
    restored: false,
    bind(
      hdr: GPUTexture,
      backdrop: { color: GPUTexture; waterDepth: GPUTexture; waterDepthView: GPUTextureView },
      opaque: GPUTexture,
      opaqueView: GPUTextureView,
      target: readonly number[],
    ) {
      from.texture = hdr;
      color.texture = backdrop.color;
      depth.texture = opaque;
      waterDepth.texture = backdrop.waterDepth;
      [extent.width, extent.height] = target;
      full[2] = extent.width;
      full[3] = extent.height;
      restore.bind(opaqueView, backdrop.waterDepthView);
    },
    /** Encodes the freeze; returns the surface rectangle the surface and composite passes scissor. */
    encode(encoder: GPUCommandEncoder, bounds: WaterBounds) {
      // Bounds a cull left empty (no kept item folded in) cover the full target, never a negative one.
      const bounded = bounds.active && bounds.surface[2] > bounds.surface[0];
      const rect = bounded ? bounds.surface : full;
      const copied = bounded ? bounds.backdrop : full;
      origin.x = copied[0];
      origin.y = copied[1];
      size.width = copied[2] - copied[0];
      size.height = copied[3] - copied[1];
      encoder.copyTextureToTexture(from, color, size);
      freeze.restored =
        rect[0] !== 0 || rect[1] !== 0 || rect[2] !== extent.width || rect[3] !== extent.height;
      if (freeze.restored) restore.encode(encoder, rect);
      else encoder.copyTextureToTexture(depth, waterDepth, extent);
      return rect;
    },
    dispose() {
      restore.dispose();
    },
  };
  return freeze;
}
