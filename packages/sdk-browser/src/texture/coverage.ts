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
  private surfaces = new Set<PageSurface>();
  /** Per colour texture, whether every reader filed so far takes its alpha for coverage. */
  private rules = new Map<Texture, boolean>();
  /** Files a surface's colour maps, once however many meshes wear it; false when already filed. */
  read(surface: PageSurface) {
    if (this.surfaces.has(surface)) return false;
    this.surfaces.add(surface);
    this.file(surface);
    return true;
  }
  /** Rereads every reader once, as the host declares it now (`refreshSurface`). */
  follow() {
    this.rules.clear();
    for (const surface of this.surfaces) this.file(refreshSurface(surface));
  }
  /** True when `texture`'s chain weighs its colours by alpha; false for one no surface wears as
   *  its map. */
  weighs(texture: Texture) {
    return !!this.rules.get(texture) && !texture.premultiplyAlpha;
  }
  private file(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) this.rules.set(map, (this.rules.get(map) ?? true) && alphaIsCoverage(surface));
    if (emissiveMap) this.rules.set(emissiveMap, false);
  }
}
