/**
 * A SOURCE JOINS THE WEBGPU SESSION IN PLACE: a source the session was not opened with — its rows,
 * its surface — draws a primitive it holds. The open's own functions run on its content alone: its
 * records are made by the collection that made the others (`createCollector`), taking the request
 * and residency keys of the records of the same primitive that a source already drawn holds; its
 * surface's textures are taken into the atlas (`appendWebgpuTexture`); its roots wait beside those a
 * growth brings and join the cut with them (`webgpuGrowth.ts`, `webgpuGrownCut.ts`), the cut taking
 * them in the room it kept (`appendDagRoots`) — their records the primitive's own, their words the
 * same — or made again over them. Refused where the records would differ (a blended or a deformed
 * primitive, a primitive no source of the session draws), so the owner opens the session again.
 */
import type { Texture } from '../../../sdk-core/src/index.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { collectedSink, drawsBlended } from '../page/selection/collect.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import { sourceSurface, type PageSurface } from '../page/surface.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import { PHYSICAL_MAP_FIELDS } from '../visibility/materialType.ts'
import { hasPhysicalLobes } from '../scene/physicalLobes.ts'
import { appendWebgpuTexture } from '../webgpu/pages/io/appendTexture.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { growthOf, joinGrownRoots } from './webgpuGrowth.ts'

type Root = ClusterRoot<PageRec>

/** The textures `surface` reads, colour then data, as the open's census takes them
 *  (`collectWebgpuMaterialTextures`). */
function texturesOf(surface: PageSurface) {
  const color = [surface.map, surface.emissiveMap, surface.subsurfaceMap]
  const data = [surface.roughnessMap, surface.metalnessMap, surface.normalMap, surface.aoMap]
  if (hasPhysicalLobes(surface)) for (const field of PHYSICAL_MAP_FIELDS) data.push(surface[field])
  return [
    ...color.map((texture) => [texture, 'color'] as const),
    ...data.map((texture) => [texture, 'data'] as const),
  ].filter((entry): entry is readonly [Texture, 'color' | 'data'] => !!entry[0])
}

/** A root of the session, or one waiting to join it, whose source draws the ranks `source` does,
 *  as opaque pages: the records `source`'s are made like. */
function siblingOf(rt: WebgpuPagesRuntime, source: DrawSource) {
  const same = (root: Root) => {
    const draw = root.pages[0]?.drawSource
    return (
      !!draw &&
      draw !== source &&
      draw.mesh === source.mesh &&
      (draw.primitives ?? 0) === (source.primitives ?? 0) &&
      !root.pages[0].transparent
    )
  }
  return rt.layout.selectionRoots.find(same) ?? growthOf(rt)?.roots.find(same)
}

/** The session draws `source` too, from now on; true once its roots wait to join. */
export async function addWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  source: DrawSource,
  primitive: Primitive,
) {
  const { gpu, run, setup } = rt
  if (!gpu.device || run.lost || !run.gpuSelection || !source.rows) return false
  const { collector } = setup
  // The primitive the session holds under the source's ranks is the one the source draws: the
  // manifest's entry shares its pages.
  const held = collector.primitiveOf({ meshes: source.mesh, primitives: source.primitives })
  if (!held || held.pages !== primitive.pages) return false
  const surface = sourceSurface(source)
  if (held.deformation || drawsBlended(held, surface) || !siblingOf(rt, source)) return false
  setup.texturePools?.coverage.read(surface)
  for (const [texture, kind] of texturesOf(surface)) await appendWebgpuTexture(rt, texture, kind)
  rt.signal.throwIfAborted()
  const sibling = siblingOf(rt, source)
  if (run.lost || !sibling || !run.gpuSelection) return false
  const into = collectedSink()
  collector.add(source, into)
  // The keys of the records it shares the primitive's pages with: the request rank, the residency
  // key, the cover's mark and the bundle's holder.
  into.allPages.forEach((rec, at) => {
    const twin = sibling.pages[at]
    rec.requestIndex = twin.requestIndex
    rec.keyIndex = twin.keyIndex
    rec.rootChild = twin.rootChild
    rec.holder = twin.holder
  })
  for (const rec of into.allPages) setup.allPages.push(rec)
  joinGrownRoots(rt, into.roots)
  return true
}
