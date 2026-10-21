/**
 * THE RUNTIME CUTTER: drawn triangles cut into engine pages, off the main thread.
 *
 * What runs here touches no platform object — no URL, no DOM, no rendering library — but the
 * SDK module, which encodes each page; so the page worker runs
 * it (`geometry/work/task.ts`, op `cut`) and the main thread runs the same function when no worker
 * lives. The triangles travel as one buffer (`packDrawn`), and the pages come back as
 * bytes with their descriptors and digests: serving them at an address is the caller's.
 */
import { encodeGeometryPage } from '../codec/encodeGeometryPage.ts'
import type { PageAttributes } from '../../../../sdk-core/src/page/pageInput.ts'
import { sphereFromBoundsBatch } from '../../../../math/src/batch/culling.ts'
import type { PageCutPage, PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { sha256Hex } from '../streaming/sha256Hex.ts'
import { clusterTriangles, type ClusterRule } from '../codec/clusterTriangles.ts'
import { primitivePrecision } from './cutGrid.ts'
import { requireSdkWasm } from '../../wasm/sdkWasm.ts'
import { buildCutProxy } from './runtimeProxy.ts'
import { buildCullingHierarchy } from '../codec/cullingHierarchy.ts'

/**
 * Cuts drawn triangles into single-level clusters of the format's size by the compiler's clusterer
 * (`clusterTriangles`), each written as its index page and its quantized geometry page
 * (`encodeGeometryPage`), with no simplification — every cluster is a root, drawn as it is. Opaque
 * `faces` take its spatial rule, the compiler's: compact patches whatever the index order, a grid
 * listed by columns or a soup cut as a cooked mesh is. A `blended` surface keeps its source order,
 * its paint order, in consecutive runs. Lines and sprites (no `faces`) keep their order too: their
 * quads have no area, their layer is coplanar. Positions sit on the compiler's grid, whose
 * precision its density sets (`cutGrid.ts`); texture coordinates are float codes of a range each
 * page holds, so a dashed line's distance along it (`drawn.ts`), however long the line, is cut
 * whole, every coordinate within a 14-bit mantissa's step of itself. Each page is bounded by the
 * box of the positions it decodes to.
 *
 * The pages come out in the clustered order, with the culling hierarchy the compiler's builder makes
 * over them, each page a leaf of its own (`buildCullingHierarchy`): the GPU descent tests the nodes
 * a view reaches, never every page. Each page keeps its first triangle in the clustered order
 * (`start`): for a blended surface its source rank, the paint rank it draws its pages in.
 */
export async function cutDrawnTriangles(
  drawn: DrawnTriangles,
  faces: boolean,
  blended: boolean,
): Promise<PageCutPayload> {
  const module = await requireSdkWasm()
  const { positions, normals, uvs, colors } = drawn
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: positions },
    ...(drawn.deformation?.joints && drawn.deformation.weights
      ? {
          JOINTS_0: {
            itemSize: drawn.deformation.influences ?? 4,
            array: drawn.deformation.joints,
          },
          WEIGHTS_0: {
            itemSize: drawn.deformation.influences ?? 4,
            array: drawn.deformation.weights,
          },
        }
      : {}),
    ...(normals.length ? { NORMAL: { itemSize: 3, array: normals } } : {}),
    ...(uvs ? { TEXCOORD_0: { itemSize: 2, array: uvs } } : {}),
    ...(colors ? { COLOR_0: { itemSize: 4, array: colors } } : {}),
  }
  const rule: ClusterRule = blended || !faces ? 'ordered' : 'spatial'
  const { indices, ranges } = clusterTriangles(module, drawn.indices, positions, rule)
  const precision = primitivePrecision(module, positions, indices, ranges)
  const cut = ranges.map(([start, end]) => {
    const corners = indices.slice(start, end)
    const page = encodeGeometryPage(
      module,
      corners,
      attributes,
      precision,
      drawn.deformation?.targets.map((target) => ({
        POSITION: { itemSize: 3, array: target.positions },
        NORMAL: { itemSize: 3, array: target.normals },
      })),
    )
    // The page's box is the box of the positions it decodes to, which a reader draws.
    const box = Float64Array.of(...page.min, ...page.max)
    const sphere = new Float64Array(4)
    sphereFromBoundsBatch(sphere, box, 1)
    return { start, corners, page, box, sphere, geometry: page.data.slice().buffer }
  })
  // Every page a root, nothing replacing it: its LOD ball is its own sphere.
  const culling = buildCullingHierarchy(
    module,
    cut.map(({ box, sphere }) => ({ min: box.subarray(0, 3), max: box.subarray(3), sphere })),
  )
  const pages: PageCutPage[] = await Promise.all(
    cut.map(async ({ start, corners, page, box, sphere, geometry }) => ({
      index: corners.buffer,
      geometry,
      indexSha256: await sha256Hex(corners.buffer),
      geometrySha256: await sha256Hex(geometry),
      count: corners.length,
      start,
      min: Array.from(box.subarray(0, 3)),
      max: Array.from(box.subarray(3)),
      sphere: Array.from(sphere),
      vertexCount: page.vertexCount,
      indexCount: page.indexCount,
      flags: page.flags,
      uncompressedBytes: page.uncompressedBytes,
    })),
  )
  // What a ray can meet: faces. A deforming cut brings what poses them (`runtimeDeform.ts`), so that its placement
  // is traced at its pose; a blended one keeps its opacity at the surface, which lets the rest of the light
  // through. Lines and sprites have no area.
  return {
    pages,
    culling,
    ...(faces && { proxy: buildCutProxy(module, indices, positions, drawn.deformation) }),
  }
}
