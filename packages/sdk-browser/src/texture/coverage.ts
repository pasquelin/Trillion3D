import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import { surfaceOpacity, type PageSurface } from '../page/surface.ts'
import { weighsByAlpha } from '../scene/materialBlending.ts'
import { cutoffByte } from './cutoffByte.ts'

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending))

/** A reader's cutoff byte: 0 when it blends, else the one it cuts at under its opacity, the
 *  product the engine cuts (`maskKeep`). */
const cutOf = (surface: PageSurface) =>
  surface.transparent ? 0 : cutoffByte(surface.alphaTest, surfaceOpacity(surface))

/** The colour maps' readers: mips weigh colours by alpha when EVERY reader takes alpha for
 *  coverage — never an emissive map (`collect.rs`) — and the texels are not premultiplied. A
 *  surface written in place is filed again from the journal of writes (`follow`): only the
 *  surfaces written are visited, never every reader of every map. */
export class CoverageReaders {
  /** The version each surface was filed at, and the maps it was filed under. */
  private filed = new WeakMap<PageSurface, { version: number; maps: Texture[] }>()
  /** Per colour texture, its readers filed — as a base or emissive map — and whether each takes
   *  its alpha for coverage. */
  private readers = new WeakMap<Texture, Map<PageSurface, boolean>>()
  /** How many times a surface was filed: a rule can have moved only since this count did,
   *  whoever filed it — a surface written (`follow`) or one added at run time (`read`). */
  filings = 0
  /** Files a surface's colour maps once per version; false when already filed. */
  read(surface: PageSurface) {
    const held = this.filed.get(surface)
    if (held && held.version === surface.version) return false
    this.file(surface)
    return true
  }
  /** Files again the surfaces of `written` (`../page/surfaceWrites.ts`) filed here: a reader moved
   *  to another map, or between blended, masked and opaque, is filed as it stands now. */
  follow(written: Iterable<PageSurface>) {
    for (const surface of written) if (this.filed.has(surface)) this.file(surface)
  }
  /** True when `texture`'s chain weighs its colours by alpha; false for one no surface wears. */
  private weighs(texture: Texture) {
    const readers = this.readers.get(texture)
    if (!readers?.size || texture.premultiplyAlpha) return false
    for (const coverage of readers.values()) if (!coverage) return false
    return true
  }
  /** The cutoff byte `C` whose share of covered texels every level of `texture`'s chain keeps
   *  (docs/FORMAT.md, "Coverage-preserving alpha"): the lowest of its masked readers', each under
   *  its opacity, 0 — the median alone — once a reader blends; none when the chain does not weigh. */
  cutoff(texture: Texture) {
    if (!this.weighs(texture)) return undefined
    let cut = 255
    for (const surface of this.readers.get(texture)!.keys()) cut = Math.min(cut, cutOf(surface))
    return cut
  }
  /** Files `surface` under the maps it wears now, out of the ones it was filed under. */
  private file(surface: PageSurface) {
    for (const map of this.filed.get(surface)?.maps ?? []) this.readers.get(map)?.delete(surface)
    const { map, emissiveMap, subsurfaceMap } = surface,
      maps: Texture[] = []
    if (map) this.wear(maps, map, surface, alphaIsCoverage(surface))
    if (emissiveMap) this.wear(maps, emissiveMap, surface, false)
    if (subsurfaceMap) this.wear(maps, subsurfaceMap, surface, false)
    this.filed.set(surface, { version: surface.version, maps })
    this.filings++
  }
  private wear(maps: Texture[], texture: Texture, surface: PageSurface, coverage: boolean) {
    let readers = this.readers.get(texture)
    if (!readers) this.readers.set(texture, (readers = new Map()))
    readers.set(surface, (readers.get(surface) ?? true) && coverage)
    maps.push(texture)
  }
}
