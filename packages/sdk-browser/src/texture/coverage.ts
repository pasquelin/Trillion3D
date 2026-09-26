import type { Texture } from '../../../sdk-core/src/index.ts';
import { refreshSurface, surfaceOpacity, type PageSurface } from '../page/surface.ts';
import { weighsByAlpha } from '../scene/materialBlending.ts';

/** Whether a surface takes its map's alpha for coverage: it cuts at `alphaTest`, or it blends
 *  weighing its colour by that alpha. A transmissive one tints what crosses it by its colour
 *  whatever its alpha (`../webgpu/water/compositeWgsl.ts`): it draws the colour under alpha 0. */
const alphaIsCoverage = (mat: PageSurface) =>
  mat.alphaTest > 0 || (mat.transparent && !(mat.transmission > 0) && weighsByAlpha(mat.blending));

/** The smallest byte `b` a surface cutting at `alphaTest` under a colour factor alpha `factor`
 *  keeps: `b / 255 × factor >= alphaTest` in f32, the product the engine cuts; 255 when none does,
 *  which the lowest over a texture's readers ignores beside any other (`cutoff_byte`,
 *  `coverage.rs`). */
export function cutoffByte(alphaTest: number, factor: number) {
  const cut = Math.fround(alphaTest),
    f = Math.fround(factor);
  // The test only grows with the byte, and f32 rounding moves its threshold `cut × 255 / f` by far
  // less than a byte: the search starts one byte under it, not at 1, on every reader of each image.
  const from = f > 0 ? Math.max(1, Math.floor((cut * 255) / f) - 1) : 1;
  for (let byte = from; byte < 256; byte++)
    if (Math.fround(Math.fround(byte / 255) * f) >= cut) return byte;
  return 255;
}

/** A reader's cutoff byte: 0 when it blends, else the one it cuts at under its opacity, the
 *  product the engine cuts (`maskKeep`). */
const cutOf = (surface: PageSurface) =>
  surface.transparent ? 0 : cutoffByte(surface.alphaTest, surfaceOpacity(surface));

/** The colour maps' readers, both GPU paths' (#42): mips weigh colours by alpha when EVERY reader
 *  takes alpha for coverage — never an emissive map (`collect.rs`) — and the texels are not
 *  premultiplied. A host switches opaque and masked with no signal: `follow` rereads them. */
export class CoverageReaders {
  private filed = new WeakMap<PageSurface, number>(); // the version each surface was filed at
  /** Per colour texture, its readers filed — as a base or emissive map — and whether every one
   *  takes its alpha for coverage. */
  private readers = new WeakMap<Texture, { surfaces: Set<PageSurface>; rule: boolean }>();
  /** Files a surface's colour maps once per version; false when already filed. */
  read(surface: PageSurface) {
    if (this.filed.has(surface) && this.filed.get(surface) === surface.version) return false;
    this.filed.set(surface, surface.version);
    this.file(surface);
    return true;
  }
  /** Rereads the readers of `maps` only — the chains that follow the rule —, as the host declares
   *  them now (`refreshSurface`), in place; a reader moved to another map is filed under it. */
  follow(maps: Iterable<Texture>) {
    for (const map of maps) {
      const held = this.readers.get(map);
      if (!held) continue;
      held.rule = true;
      for (const surface of held.surfaces) {
        const { map: base, emissiveMap } = refreshSurface(surface);
        if (base === map || emissiveMap === map)
          held.rule &&= emissiveMap !== map && alphaIsCoverage(surface);
        else if (held.surfaces.delete(surface)) this.file(surface);
      }
      held.rule &&= held.surfaces.size > 0;
    }
  }
  /** True when `texture`'s chain weighs its colours by alpha; false for one no surface wears. */
  weighs(texture: Texture) {
    return !!this.readers.get(texture)?.rule && !texture.premultiplyAlpha;
  }
  /** The cutoff byte `C` whose share of covered texels every level of `texture`'s chain keeps
   *  (docs/FORMAT.md, "Coverage-preserving alpha"): the lowest of its masked readers', each under
   *  its opacity, 0 — the median alone — once a reader blends; none when the chain does not weigh. */
  cutoff(texture: Texture) {
    const held = this.weighs(texture) ? this.readers.get(texture)! : undefined;
    return held && Math.min(255, ...[...held.surfaces].map(cutOf));
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
