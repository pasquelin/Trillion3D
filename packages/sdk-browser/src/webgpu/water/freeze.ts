import type { WaterBounds } from './bounds.ts';

/**
 * The backdrop freeze of the water pass: the lit image copied within the refraction reach. Without
 * active bounds (`bounds.ts`), it covers what the image draws: the full target, or its top-left
 * below it (`../pages/state/renderScale.ts`). The opaque depth the surface stage tests is restored
 * by the surface pass's first draw (`frame.ts`).
 * The descriptors are the frame's, rewritten in place: a frame allocates nothing.
 */
export function createWaterFreeze() {
  const origin = { x: 0, y: 0 },
    size = { width: 1, height: 1 },
    full = new Float64Array(4);
  const from = { texture: undefined as unknown as GPUTexture, origin },
    color = { texture: undefined as unknown as GPUTexture, origin };
  return {
    bind(hdr: GPUTexture, backdrop: { color: GPUTexture }) {
      from.texture = hdr;
      color.texture = backdrop.color;
    },
    /** Encodes the freeze; returns the surface rectangle the surface and composite passes scissor. */
    encode(encoder: GPUCommandEncoder, bounds: WaterBounds, [width, height]: readonly number[]) {
      // What the image draws, the targets' top-left: the rectangle without bounds.
      full[2] = width;
      full[3] = height;
      // Bounds a cull left empty (no kept item folded in) cover the full target, never a negative one.
      const bounded = bounds.active && bounds.surface[2] > bounds.surface[0];
      const rect = bounded ? bounds.surface : full;
      const copied = bounded ? bounds.backdrop : full;
      origin.x = copied[0];
      origin.y = copied[1];
      size.width = copied[2] - copied[0];
      size.height = copied[3] - copied[1];
      encoder.copyTextureToTexture(from, color, size);
      return rect;
    },
  };
}
