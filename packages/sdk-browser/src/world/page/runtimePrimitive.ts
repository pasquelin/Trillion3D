import { unpackDrawn } from './runtimePack.ts'
import { runtimeDeformation } from './runtimeDeformation.ts'
import type { Page, Primitive } from '../../../../sdk-core/src/index.ts'
import { LINE_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import type { PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'
import { cutPagesOffThread } from '../../page/work/host.ts'
import { sphereFromBounds } from '../../../../sdk-core/src/math/primitives/sphere.ts'
import { BOX_VALUES } from '../../../../sdk-core/src/math/primitives/box.ts'

/** A runtime primitive, and the addresses its pages are served from until it is released. */
export type RuntimePrimitive = { primitive: Primitive; urls: string[] }

/** Bytes served at an address of their own, with the digest the page reader checks. */
function served(bytes: ArrayBuffer, sha256: string, urls: string[]) {
  const url = URL.createObjectURL(new Blob([bytes]))
  urls.push(url)
  return { url, sha256, bytes: bytes.byteLength }
}

/** What the cut triangles are, beside faces (`DrawnTriangles`). */
export type DrawnKind = { lines?: boolean; spriteRadius?: number }

/** A dynamic primitive's held box: six numbers, the least corner then the greatest. */
export type HeldBox = Float64Array

/** The box and ball of dynamic page `k`: its own corners where they were cut, as `boxes` holds them
 *  (`BOX_VALUES` a page, `../core/pageMotion.ts`). A rewrite moves them by at most its root's
 *  `reach`, which every cut grows this box by, as a deformation's; a row reads its page's box where
 *  its vertices are now (`PageRec.moved`). */
function restBounds(boxes: Float64Array, k: number) {
  const box = boxes.subarray(k * BOX_VALUES, (k + 1) * BOX_VALUES),
    sphere = new Float64Array(4)
  sphereFromBounds(sphere, 0, box[0], box[1], box[2], box[3], box[4], box[5])
  return { min: [...box.subarray(0, 3)], max: [...box.subarray(3)], sphere: [...sphere] }
}

/** The box and ball of a page: its own, or for a sprite's quad, which the rasters turn to face
 *  the camera about its origin (`drawnSprite`), the cube and ball of its radius there — what
 *  holds the quad whichever way it turns, so a sprite is culled by that ball. */
function bounds(page: PageCutPayload['pages'][number], radius: number | undefined) {
  if (radius === undefined) return { min: page.min, max: page.max, sphere: page.sphere }
  return {
    min: [-radius, -radius, -radius],
    max: [radius, radius, radius],
    sphere: [0, 0, 0, radius],
  }
}

/** The pages of a cut, served at addresses of their own: the primitive a manifest lists. The
 *  pages of line quads draw one coplanar layer over the faces they lie on (`LINE_DEPTH_LAYER`).
 * With `boxes`, the primitive is dynamic: index pages alone, no geometry page and no normal
 *  cone — its vertices, read as floats from the host geometry, are rewritten in place —, each page
 *  bounded by its own corners where they were cut (`restBounds`). */
export function servePrimitive(cut: PageCutPayload, kind: DrawnKind, boxes?: Float64Array) {
  const urls: string[] = []
  const held = !!boxes
  const pages: Page[] = cut.pages.map((page, id) => ({
    id,
    ...served(page.index, page.indexSha256, urls),
    count: page.count,
    ...(boxes ? restBounds(boxes, id) : bounds(page, kind.spriteRadius)),
    role: 'exact',
    start: page.start,
    level: 0,
    lodError: 0,
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    ...(kind.lines && { depthLayer: LINE_DEPTH_LAYER }),
    ...(page.cone && !held && { cone: page.cone }),
    ...(!held && {
      geometry: {
        ...served(page.geometry, page.geometrySha256, urls),
        vertexCount: page.vertexCount,
        indexCount: page.indexCount,
        flags: page.flags,
        uncompressedBytes: page.uncompressedBytes,
      },
    }),
  }))
  const primitive: Primitive = {
    mesh: 0,
    primitive: 0,
    pass: 'exact-clusters',
    clusterStrategy: 'dag-groups',
    pages,
    structure: { version: 1, roots: pages.map((page) => page.id), groups: [] },
    quantization: {
      positionExponent: cut.positionExponent,
      uvExponent: cut.uvExponent,
      maxPositionError: held ? 0 : cut.maxPositionError,
    },
    ...(held && { dynamic: true }),
  }
  return { primitive, urls } satisfies RuntimePrimitive
}

/**
 * Cuts drawn triangles, packed by `packDrawn` and yielded, into engine pages at run time — in the page worker, where one lives, by
 * the same function on the main thread otherwise (`runtimeCut.ts`) — and serves them. The pages
 * then enter the session like a compiled model's: read by the streamer at their address, held
 * in the same pools under the same budgets, evicted by the same rules.
 */
export async function cutRuntimePrimitive(
  packed: ArrayBuffer,
  kind: DrawnKind,
): Promise<RuntimePrimitive> {
  const deformation = runtimeDeformation(unpackDrawn(packed).drawn)
  const result = servePrimitive(await cutPagesOffThread(packed), kind)
  if (deformation) result.primitive.deformation = deformation
  return result
}
