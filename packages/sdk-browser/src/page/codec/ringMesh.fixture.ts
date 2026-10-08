// A real page for the codec's tests and the GPU decoding proof: it comes out of the reference
// encoder `packages/page-codec`, the oracle of the JavaScript decoder, so what is compared is two
// reads of a real page, not of a buffer made for the occasion.
import { TAU } from '../../../../math/src/constants.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import type { PageAttributes } from '../../../../page-codec/src/pageAttributes.ts'

/**
 * A ring of `triangles` triangles sharing their vertices, every attribute carried, positions off
 * the grid of `exponent`; the colour `colorWidth` wide, three for a source without alpha.
 * Returns the encoded page with the source indices and attributes it came from.
 */
export function ringMesh(triangles: number, exponent: number, colorWidth = 4) {
  const count = triangles + 2,
    position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    uv2 = new Float32Array(count * 2),
    color = new Float32Array(count * colorWidth)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU
    position.set([Math.cos(angle) * 2.3 + 100.7, Math.sin(angle) * 2.3 - 40.1, i * 0.0173], i * 3)
    normal.set([Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, i % 2 ? 0.8 : -0.8], i * 3)
    uv.set([i / count, 0.5 + Math.sin(angle) * 0.25], i * 2)
    uv2.set([3 + i * 0.01, 7 - i * 0.02], i * 2)
    color.set([i / count, 1 - i / count, 0.5, 1].slice(0, colorWidth), i * colorWidth)
  }
  const indices: number[] = []
  for (let t = 0; t < triangles; t++) indices.push(t, t + 1, t + 2)
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    TEXCOORD_1: { itemSize: 2, array: uv2 },
    COLOR_0: { itemSize: colorWidth, array: color },
  }
  return { encoded: encodeGeometryPage(indices, attributes, exponent), indices, attributes }
}
