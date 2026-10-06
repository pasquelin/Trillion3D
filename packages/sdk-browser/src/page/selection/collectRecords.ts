import type { Primitive } from '../../../../sdk-core/src/index.ts'
import { quantizationErrorOf } from './helpers.ts'
import type { Template } from './template.ts'
import type { PageRec } from './types.ts'
import type { HostMesh } from '../../host/resources.ts'
import type { PageSurface } from '../surface.ts'

/** Grows a box by the grid's quantization error: the surface an engine draws from the pages is the
 *  quantized one, so every bound encloses it. No error, the box is shared as-is. */
function widened(bounds: number[], sign: number, slack: number) {
  return slack > 0 ? bounds.map((value) => value + sign * slack) : bounds
}

/**
 * ONE record per primitive page (#1235), shared by every placement of the primitive — its rows, its
 * replicas, every source object that names it. Its world, its row and its packed rank belong to the
 * layout, never to the record; only what the compiler computed of the page and the declaration it
 * was read from live here. Built once per primitive, never per placement.
 */
export function createPageRecords(
  primitive: Primitive,
  template: Template,
  mesh: HostMesh,
  surface: PageSurface,
  transparent: boolean,
  order: number,
): PageRec[] {
  // The grid moved each position by at most this much: the page boxes grow by it, so culling still
  // encloses the quantized surface an engine draws.
  const slack = quantizationErrorOf(primitive)
  return primitive.pages.map((page, pageIndex) => {
    const entry = template.pages[pageIndex],
      cut = entry.cut,
      streamed = entry.placed
    return {
      id: page.id,
      url: page.url,
      clusterId: entry.clusterId,
      array: entry.array,
      triangles: page.count / 3,
      indexBytes: entry.array?.byteLength ?? page.bytes,
      // Transparent, it draws from its geometry page as opaque does (`webgpu/blend/shader.ts`).
      geometryPage: page.geometry,
      min: widened(page.min, -1, slack),
      max: widened(page.max, 1, slack),
      // A dynamic page's box this frame (#573), set by its rewrites: one record shape for all.
      moved: undefined,
      role: page.role,
      level: cut.level,
      lodError: cut.lodError,
      sphere: cut.sphere,
      parentError: cut.parentError,
      parentSphere: cut.parentSphere,
      group: cut.group,
      source: cut.source,
      streamUrl: streamed?.url,
      streamOffset: streamed?.offset,
      depthLayer: page.depthLayer ?? 0,
      attributes: mesh.geometry.attributes,
      material: surface,
      declaration: mesh.material,
      transparent,
      sourceMesh: mesh,
      // A flat cut has no tree: transparent pages recover their draw order from the source rank,
      // recorded for every class, since a page may turn blended in the session (#846).
      sourceOrder: template.sourceOrder[pageIndex],
      renderOrder: order,
      cone: page.cone,
    }
  })
}
