/**
 * A SOURCE JOINS THE WEBGPU SESSION IN PLACE: a source the session was not opened with — its rows,
 * its surface — draws a primitive, one the session holds or one it does not. The open's own functions
 * run on its content alone: a primitive the session does not hold joins the manifest and the read
 * queue (`EngineContext.admitPages`); its records are made by the collection that made the others
 * (`createCollector`); the catalogue ranks and lists them (`growCatalogue`) and the pool is laid out
 * for the pages they add (`growWebgpuPagePool`); its surface's textures are taken into the atlas
 * (`appendWebgpuTexture`); its roots wait beside those a growth brings and join the cut with them
 * (`webgpuGrowth.ts`, `webgpuGrownCut.ts`), the cut taking them in the room it kept
 * (`appendDagRoots`). A blended or transmissive source brings copies, which join the transparent
 * pass with them (`webgpu/blend/growth.ts`), the water pass and its targets made for the first
 * transmissive one. A source the deformation stage moves — a skeleton, morph weights, waves — or one
 * whose vertices are read as floats joins with its records and its float geometries, the stage's code
 * loaded when the session had none (`deformation/growth.ts`). Refused where the catalogue or the
 * pass cannot hold it (`catalogueRefusal`, `blendRefusal`).
 */
import type { Texture } from '../../../sdk-core/src/index.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { collectedSink, drawsBlended } from '../page/selection/collect.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import { sourceSurface, type PageSurface } from '../page/surface.ts'
import { PHYSICAL_MAP_FIELDS } from '../visibility/materialType.ts'
import { hasPhysicalLobes } from '../scene/physicalLobes.ts'
import { appendWebgpuTexture } from '../webgpu/pages/io/appendTexture.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { joinGrownRoots } from './webgpuGrowth.ts'
import { primitivePages } from '../scene/manifestPageIndex.ts'
import {
  catalogueRefusal,
  growCatalogue,
  holdCatalogueCover,
} from '../webgpu/pages/prepare/catalogueGrowth.ts'
import { growWebgpuPagePool } from '../webgpu/pages/io/memory.ts'
import { blendRefusal, prepareBlendGrowth } from '../webgpu/blend/growth.ts'
import { deformsContent, prepareDeformationGrowth } from '../deformation/growth.ts'
import { byRenderOrder, pagedBlendCopiesOf } from '../webgpu/pages/prepare/setupCatalogue.ts'

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

/** The session draws `source` too, from now on; true once its roots wait to join. */
export async function addWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  source: DrawSource,
  primitive: Primitive,
) {
  const { gpu, run, setup, context } = rt
  if (!gpu.device || run.lost || !run.gpuSelection || !source.rows) return false
  const { collector } = setup
  // The primitive the session holds under the source's ranks is the one the source draws: the
  // manifest's entry shares its pages. One it does not hold joins the manifest.
  const ranks = { meshes: source.mesh, primitives: source.primitives }
  const held = collector.primitiveOf(ranks)
  if (held && held.pages !== primitive.pages) return false
  const surface = sourceSurface(source)
  if (drawsBlended(primitive, surface) && blendRefusal(rt)) return false
  if (!held) {
    context.metadata.primitives.push(primitive)
    collector.primitiveOf.add(primitive)
    context.admitPages?.(primitivePages(primitive))
  }
  setup.texturePools?.coverage.read(surface)
  for (const [texture, kind] of texturesOf(surface)) await appendWebgpuTexture(rt, texture, kind)
  rt.signal.throwIfAborted()
  if (run.lost || !run.gpuSelection) return false
  const into = collectedSink()
  collector.add(source, into)
  if (catalogueRefusal(rt, into.allPages)) return false
  // The copies it draws blended or transmissive, ordered as the open orders them.
  const copies = [...into.blendCopies, ...pagedBlendCopiesOf(into.roots, setup.pagedBlendCopies)]
  copies.sort(byRenderOrder)
  if (!(await prepareBlendGrowth(rt, gpu.device, copies, into.allPages))) return false
  rt.signal.throwIfAborted()
  if (run.lost || !run.gpuSelection) return false
  // The deformation stage, and the float geometries its pages read, for what moves or is rewritten.
  const deforms = deformsContent(source, primitive, into.allPages)
  if (!(await prepareDeformationGrowth(rt, gpu.device, deforms, into.allPages))) return false
  rt.signal.throwIfAborted()
  if (run.lost || !run.gpuSelection) return false
  const { grown, cover } = growCatalogue(rt, into)
  if (!(await growWebgpuPagePool(rt, grown))) return false
  rt.signal.throwIfAborted()
  if (run.lost) return false
  holdCatalogueCover(rt, cover)
  setup.blendCopies.push(...copies)
  joinGrownRoots(rt, into.roots, copies)
  return true
}
