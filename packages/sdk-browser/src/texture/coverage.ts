import type { Texture } from '../../../sdk-core/src/index.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import { weighsByAlpha } from '../scene/materialBlending.ts';

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending));

/**
 * The readers of the colour textures, and whether each texture's mip chain weighs its colours by
 * alpha — the compiler's `Coverage` chain (#42), shared by both GPU paths: EVERY reader takes its
 * alpha for coverage — the map of a masked or alpha-blended surface, never an emissive map, the
 * decision `collect.rs` takes —, and its texels were not uploaded premultiplied, which already
 * carry the weight: weighing twice would darken them. A host switches a surface between opaque
 * and masked without a new prepare: `follow` rereads the readers as the host declares them now.
 */
export class CoverageReaders {
  private surfaces: PageSurface[] = [];
  /** Per colour texture, whether every reader filed so far takes its alpha for coverage. */
  private rules = new Map<Texture, boolean>();
  /** Files a surface's colour maps. */
  read(surface: PageSurface) {
    this.surfaces.push(surface);
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
    this.surfaces.length = 0;
    this.rules.clear();
  }
  private file(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) this.rules.set(map, (this.rules.get(map) ?? true) && alphaIsCoverage(surface));
    if (emissiveMap) this.rules.set(emissiveMap, false);
  }
}
