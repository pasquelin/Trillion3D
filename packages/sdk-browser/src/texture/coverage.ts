import type { Texture } from '../../../sdk-core/src/index.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import { weighsByAlpha } from '../scene/materialBlending.ts';

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending));

/** The colour maps' readers, both GPU paths' (#42): mips weigh colours by alpha when EVERY reader
 *  takes alpha for coverage — never an emissive map (`collect.rs`) — and the texels are not
 *  premultiplied. A host switches opaque and masked with no signal: `follow` rereads them. */
export class CoverageReaders {
  private filed = new WeakSet<PageSurface>();
  /** Per colour texture, the surfaces filed as wearing it, as a base or an emissive map. */
  private readers = new Map<Texture, Set<PageSurface>>();
  /** Per colour texture, whether every reader filed so far takes its alpha for coverage. */
  private rules = new Map<Texture, boolean>();
  /** Files a surface's colour maps, once however many meshes wear it; false when already filed. */
  read(surface: PageSurface) {
    if (this.filed.has(surface)) return false;
    this.filed.add(surface);
    this.file(surface);
    return true;
  }
  /** Rereads the readers of `maps` only — the chains that follow the rule —, as the host declares
   *  them now (`refreshSurface`); a reader moved to another map is filed under it. */
  follow(maps: Iterable<Texture>) {
    for (const map of maps) {
      const readers = this.readers.get(map);
      this.readers.delete(map);
      this.rules.delete(map);
      for (const surface of readers ?? []) this.file(refreshSurface(surface));
    }
  }
  /** True when `texture`'s chain weighs its colours by alpha; false for one no surface wears as
   *  its map. */
  weighs(texture: Texture) {
    return !!this.rules.get(texture) && !texture.premultiplyAlpha;
  }
  private file(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) this.wear(map, surface, alphaIsCoverage(surface));
    if (emissiveMap) this.wear(emissiveMap, surface, false);
  }
  private wear(texture: Texture, surface: PageSurface, coverage: boolean) {
    (this.readers.get(texture) ?? this.readers.set(texture, new Set()).get(texture)!).add(surface);
    this.rules.set(texture, (this.rules.get(texture) ?? true) && coverage);
  }
}
