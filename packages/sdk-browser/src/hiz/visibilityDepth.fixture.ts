// The CPU reference of the visibility buffer's depth, which the Hi-Z tests and the browser proofs
// build their pyramids from (`buildHizPyramid`, `bench/oracles/browser/hizPyramid.ts`).
import { DEPTH_CLEAR } from '../camera/depthConvention.ts'
import { createVisibilityFrame } from '../../../../bench/oracles/browser/cpu-image/frame.ts'
import { barycentricAt } from '../../../../bench/oracles/browser/cpu-image/math.ts'
import { signedArea } from '../../../../bench/oracles/browser/cpu-image/projection.ts'
import type { VisPage } from '../visibility/buffer.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { PageLocations } from '../page/selection/placements.ts'

/** NDC z of the visbuffer winner. Background pixels stay at the far value. A triangle's vertices
 *  are projected once per frame, never once per pixel: the same operands, less often. */
export function visibilityDepth(
  ids: Uint32Array,
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height)
  depth.fill(DEPTH_CLEAR)
  const frame = createVisibilityFrame(pages, locations, cam, width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const triangle = frame.triangle(ids[y * width + x])
      if (!triangle) continue
      const { a, b, c } = triangle
      const area = signedArea(a, b, c)
      if (area === 0) continue
      const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area)
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const z = w0 * a.z + w1 * b.z + w2 * c.z
      if (!Number.isFinite(z)) continue
      depth[y * width + x] = z
    }
  return depth
}
