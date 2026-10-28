import { stackedMapsOf } from '../../materials/classes/materialTextures.ts'
import { noteStacks, siblingWords, type SiblingSets } from '../../materials/virtual/stacks.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * The stacks of a material (`../../materials/virtual/stacks.ts`) a map joined after open: the
 * maps of it that lie in the atlases are listed to each other, beside the siblings their tables
 * already hold. The open does the same for every material (`../prepare/textureSteps.ts`).
 */
export function restackMaterial(rt: WebgpuPagesRuntime, surface: PageSurface) {
  const streamer = rt.vis.textures
  if (!streamer) return
  const stacked = stackedMapsOf(surface, rt.vis.mapLayer, rt.vis.dataLayer)
  const sets: SiblingSets = { color: [], data: [] }
  noteStacks(sets, stacked)
  const atlases = { color: streamer.color.textures, data: streamer.data.textures }
  const joins = stacked
    .map(({ kind, slot }) => ({
      kind,
      slot,
      words: siblingWords(atlases, atlases[kind][slot], sets[kind][slot]),
    }))
    .filter(({ words }) => words.length)
  if (joins.length) streamer.stack(joins)
}
