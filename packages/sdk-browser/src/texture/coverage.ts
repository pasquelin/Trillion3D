import type { Texture } from '../../../sdk-core/src/index.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import { weighsByAlpha } from '../scene/materialBlending.ts';

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending));

/**
 * The readers of the colour textures, shared by both GPU paths (#42): a texture's mips weigh its
 * colours by alpha when EVERY reader takes its alpha for coverage — never an emissive map, as
 * `collect.rs` decides — and its texels were not uploaded premultiplied (weighed twice, they
 * darken). A host switches a surface between opaque and masked without a signal: `follow`
 * rereads the readers as it declares them now.
 */
export class CoverageReaders {
  private surfaces = new Set<PageSurface>();
  /** Per colour texture, whether every reader filed so far takes its alpha for coverage. */
  private rules = new Map<Texture, boolean>();
  /** Files a surface's colour maps, once however many meshes wear it. */
  read(surface: PageSurface) {
    if (this.surfaces.has(surface)) return;
    this.surfaces.add(surface);
    this.file(surface);
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
  clear() {
    this.surfaces.clear();
    this.rules.clear();
  }
  private file(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) this.rules.set(map, (this.rules.get(map) ?? true) && alphaIsCoverage(surface));
    if (emissiveMap) this.rules.set(emissiveMap, false);
  }
}
