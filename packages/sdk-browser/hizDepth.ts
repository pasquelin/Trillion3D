import { hizBuildFlat } from '../sdk-core/index.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';
import { createVisibilityFrame } from './visibilityFrame.ts';
import { barycentricAt, signedArea } from './visibilityProjection.ts';
import type { VisPage } from './visibilityBuffer.ts';
import type { HizPyramid } from './hizTypes.ts';
import type { EngineCamera } from './cameraWorld.ts';

/**
 * Visbuffer Hi-Z pyramid: far background, reduce toward farthest. The pyramid is flat: one buffer
 * for every level. `into` reuses it from frame to frame — same size, same offsets, no row
 * reallocated; otherwise a new pyramid is placed.
 */
export function buildHizPyramid(
  depth: Float32Array,
  width: number,
  height: number,
  into?: HizPyramid,
): HizPyramid {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  return hizBuildFlat(depth, width, height, into);
}

/** NDC z of the visbuffer winner. Background pixels stay at the far value. A triangle's vertices
 *  are projected once per frame, never once per pixel: the same operands, less often. */
export function visibilityDepth(
  ids: Uint32Array,
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height);
  depth.fill(DEPTH_CLEAR);
  const frame = createVisibilityFrame(pages, cam, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const triangle = frame.triangle(ids[y * width + x]);
      if (!triangle) continue;
      const { a, b, c } = triangle;
      const area = signedArea(a, b, c);
      if (area === 0) continue;
      const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      if (!Number.isFinite(z)) continue;
      depth[y * width + x] = z;
    }
  return depth;
}
