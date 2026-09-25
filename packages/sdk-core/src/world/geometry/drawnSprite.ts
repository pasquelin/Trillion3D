import type { DrawnTriangles } from './drawn.ts';

/**
 * A sprite's quad as every raster reads it (`spriteWgsl.ts` in sdk-browser): its corners moved in
 * their plane by `0.5 − center`, so the point `center` of the picture sits on the sprite's origin,
 * as the reference's `(position.xy − (center − 0.5))` places it. The rasters read `x` and `y`
 * alone, scale them by the sprite's world scale, turn them by the material's rotation and lay
 * them in the image plane about the origin. `spriteRadius`, the farthest corner from the origin,
 * bounds the quad however it turns: the culling box of its pages is the cube of that half-width.
 */
export function drawnSprite(
  drawn: DrawnTriangles | null,
  center: readonly [number, number] = [0.5, 0.5],
): DrawnTriangles | null {
  if (!drawn) return null;
  const positions = drawn.positions.slice();
  let radius = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    positions[i] += 0.5 - center[0];
    positions[i + 1] += 0.5 - center[1];
    radius = Math.max(radius, Math.hypot(positions[i], positions[i + 1]));
  }
  return { ...drawn, positions, spriteRadius: radius };
}
