import type { Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { Template } from './template.ts'
import type { PageRec } from './types.ts'
import type { DrawSource } from './drawSource.ts'
import type { PageSurface } from '../pages/surface.ts'

/**
 * ONE record per primitive page, shared by every placement of the primitive — its rows, its
 * replicas, every source object that names it. Its world, its row and its packed rank belong to the
 * layout, never to the record; only what the compiler computed of the page and the surface record
 * it wears live here. Built once per primitive, never per placement.
 */
export function createPageRecords(
  primitive: Primitive,
  template: Template,
  drawSource: DrawSource,
  surface: PageSurface,
  transparent: boolean,
  order: number,
): PageRec[] {
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
      // Transparent, it draws from its geometry page as opaque does (`blend/shader.ts`).
      geometryPage: page.geometry,
      min: page.min,
      max: page.max,
      // A dynamic page's box this frame, set by its rewrites: one record shape for all.
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
      ...(streamed?.pinned && { pinned: true as const }),
      depthLayer: page.depthLayer ?? 0,
      attributes: drawSource.attributes,
      material: surface,
      transparent,
      drawSource,
      // A flat cut has no tree: transparent pages recover their draw order from the source rank,
      // recorded for every class, since a page may turn blended in the session.
      sourceOrder: template.sourceOrder[pageIndex],
      renderOrder: order,
    }
  })
}
