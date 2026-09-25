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
  /** Per colour texture, its readers filed — as a base or emissive map — and whether every one
   *  takes its alpha for coverage. */
  private readers = new Map<Texture, { surfaces: Set<PageSurface>; rule: boolean }>();
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
      const held = this.readers.get(map);
      this.readers.delete(map);
      for (const surface of held?.surfaces ?? []) this.file(refreshSurface(surface));
    }
  }
  /** True when `texture`'s chain weighs its colours by alpha; false for one no surface wears. */
  weighs(texture: Texture) {
    return !!this.readers.get(texture)?.rule && !texture.premultiplyAlpha;
  }
  private file(surface: PageSurface) {
    const { map, emissiveMap } = surface;
    if (map) this.wear(map, surface, alphaIsCoverage(surface));
    if (emissiveMap) this.wear(emissiveMap, surface, false);
  }
  private wear(texture: Texture, surface: PageSurface, coverage: boolean) {
    const held = this.readers.get(texture);
    if (!held) this.readers.set(texture, { surfaces: new Set([surface]), rule: coverage });
    else held.rule = held.surfaces.add(surface) && held.rule && coverage;
  }
}
