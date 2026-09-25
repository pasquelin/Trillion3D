import type { Texture } from '../../../sdk-core/src/index.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import { weighsByAlpha } from '../scene/materialBlending.ts';

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending));

/** Whether a texture's mip chain weighs its colours by alpha — the compiler's `Coverage` chain
 *  (#42) —: every reader takes its alpha for coverage, and its texels were not uploaded
 *  premultiplied, which already carry the weight: weighing twice would darken them. */
export const mipsWeighByAlpha = (texture: Texture, coverage: boolean) =>
  coverage && !texture.premultiplyAlpha;

/**
 * The readers of each colour texture, and whether EVERY one takes its alpha for coverage — the map
 * of a masked or alpha-blended surface, never an emissive map: the decision `collect.rs` takes for
 * the compiler's `Coverage` chain (#42), shared by both GPU paths. The answer is read NOW, from the
 * surfaces as the host declares them (`refreshSurface`): a host switches a surface between opaque
 * and masked without a new prepare, and the chain follows.
 */
export class CoverageReaders {
  /** Per colour texture, the surfaces that wear it as their map; `null` once one wears it as its
   *  emissive map, which never reads its alpha. */
  private readers = new Map<Texture, PageSurface[] | null>();
  /** Files a surface's colour maps. */
  read(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) {
      const list = this.readers.get(map);
      if (list) list.push(surface);
      else if (list === undefined) this.readers.set(map, [surface]);
    }
    if (emissiveMap) this.readers.set(emissiveMap, null);
  }
  /** True when every reader of `texture` takes its alpha for coverage now; false for one no
   *  surface wears as its map. */
  coverage(texture: Texture) {
    const list = this.readers.get(texture);
    return !!list && list.every((surface) => alphaIsCoverage(refreshSurface(surface)));
  }
  clear() {
    this.readers.clear();
  }
}
