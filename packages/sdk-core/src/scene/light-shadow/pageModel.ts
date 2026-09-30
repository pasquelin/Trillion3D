import { NUMBERS, type PageOps } from './pageOps.ts';
import { pageKeyModel } from './pageKeys.ts';
import { pageViewModel } from './pageViewModel.ts';
import {
  LAMP_FACE_ENTRIES,
  LAMP_MIPS,
  LAMP_SIDE,
  SHADOW_PAGE,
  SUN_LEVELS,
  SUN_WINDOW,
  shadowEntrySpan,
  shadowTableEntries,
} from './virtual.ts';

/** Texels around a read point that the PCF's bilinear footprints reach, on each axis: a point
 *  nearer a page's edge than this reads the neighbour across it (`shadowPcf`). */
const PCF_EDGE_TEXELS = 1.5;

/**
 * THE PAGE MODEL: where a page's word sits in the table, which level or mip a pixel reads, which
 * page a map texel lies in and which neighbours the PCF reads around it. Each formula is written
 * once, over `PageOps`: evaluated on numbers it is the scheduler's, printed as WGSL it is the
 * shaders' (`PAGE_MODEL_WGSL`) — one source, so the two can never address a page differently.
 * It also decodes an entry back into its page, as the GPU allocator maps it (#1275), and ranks it.
 * The page formulas over `o`, by their WGSL names.
 */
export function pageModel<V>(o: PageOps<V>, windowPages = SUN_WINDOW) {
  const ring = (v: V, n: V) => o.mod(o.add(o.mod(v, n), n), n);
  const texel = (level: V) => o.exp2(o.toFloat(level));
  const page = o.float(SHADOW_PAGE),
    reach = o.float(PCF_EDGE_TEXELS);
  const levelOf = (footprint: V) => o.toInt(o.floor(o.log2(o.max(footprint, o.float(1e-30)))));
  /** Entries of a lamp face's mips finer than `mip`. */
  const finer = (mip: V) => {
    const pages = o.shr(o.int(LAMP_SIDE), mip);
    return o.div(
      o.mul(o.int(4), o.sub(o.int(LAMP_SIDE * LAMP_SIDE), o.mul(pages, pages))),
      o.int(3),
    );
  };
  /** The mip of the page `rest` entries into a lamp face: the finer mips whose entries it is
   *  past, counted exactly. */
  const entryMip = (rest: V) => {
    let mip = o.int(0);
    for (let m = 1; m < LAMP_MIPS; m++)
      mip = o.add(mip, o.pick(o.ge(rest, finer(o.int(m))), o.int(1), o.int(0)));
    return mip;
  };
  return {
    /** Non-negative remainder of `v` by `n`. */
    shadowRing: ring,
    /** Entry of absolute page `(x, y)` in a ring of `pages²` entries. */
    shadowRingPageEntry: (pages: V, x: V, y: V) =>
      o.add(o.mul(ring(y, pages), pages), ring(x, pages)),
    /** Entry of page `(x, y)` of a map `pages` wide, row by row. */
    shadowFacePageEntry: (pages: V, x: V, y: V) => o.add(o.mul(y, pages), x),
    /** First entry of sun `level`: its slot in the ring of `SUN_LEVELS`, an extent `windowPages²` wide. */
    shadowSunLevelEntry: (level: V) =>
      o.mul(ring(level, o.int(SUN_LEVELS)), o.int(windowPages * windowPages)),
    /** First entry of `mip` of lamp `face`: the faces before it, then its finer mips — `S²`, `S²/4`,
     *  … pages, `4 (S² − p²) / 3` together for `p = S >> mip`, exact for a side `S` a power of two. */
    shadowLampMapEntry: (face: V, mip: V) =>
      o.add(o.mul(face, o.int(LAMP_FACE_ENTRIES)), finer(mip)),
    shadowLampEntryMip: entryMip,
    /** Pages on a side of a lamp face's `mip`. */
    shadowLampMipPages: (mip: V) => o.shr(o.int(LAMP_SIDE), mip),
    /** The page `rest` entries into a lamp face, counted within its own mip, row by row. */
    shadowLampEntryLocal: (rest: V) => o.sub(rest, finer(entryMip(rest))),
    /** Column and row of page `local` of a map `pages` wide (`shadowFacePageEntry` undone). */
    shadowFacePageX: (pages: V, local: V) => o.mod(local, pages),
    shadowFacePageY: (pages: V, local: V) => o.div(o.sub(local, o.mod(local, pages)), pages),
    /** The light view of `mip` of lamp face `face`, the key its pages are drawn under. */
    shadowLampView: (face: V, mip: V) => o.add(o.mul(face, o.int(16)), mip),
    /** The sun level clipmap slot `slot` holds while the finest level is `finest`. */
    shadowSunSlotLevel: (slot: V, finest: V) =>
      o.add(finest, ring(o.sub(slot, finest), o.int(SUN_LEVELS))),
    /** Absolute page, on one axis, at ring position `r` of a ring `pages` wide from `origin`. */
    shadowRingPage: (r: V, origin: V, pages: V) => o.add(origin, ring(o.sub(r, origin), pages)),
    /** 1 when `v` lies in `[first, first + count)`, else 0: a level or a page a clipmap holds. */
    shadowWindowHolds: (v: V, first: V, count: V) =>
      o.pick(o.or(o.lt(v, first), o.ge(v, o.add(first, count))), o.int(0), o.int(1)),
    /** How coarse a page is within its light, on one scale for every light (`RANKS`): a sun level's
     *  steps above its finest over `SUN_LEVELS`, a lamp mip over `LAMP_MIPS`, both in whole steps of
     *  their common denominator — a clipmap and a mip chain count different things. */
    shadowSunCoarseness: (level: V, finest: V) => o.mul(o.sub(level, finest), o.int(LAMP_MIPS)),
    shadowLampCoarseness: (mip: V) => o.mul(mip, o.int(SUN_LEVELS)),
    /** The sun level whose texel, `2^L` metres, is at most `footprint`. */
    shadowSunLevelOf: levelOf,
    /** The level a pixel of footprint `footprint` reads: its own, never finer than `finest`. */
    shadowSunReadLevel: (footprint: V, finest: V) => o.max(levelOf(footprint), finest),
    /** Side of a texel of sun `level`, in metres. */
    shadowSunTexelMetres: texel,
    /** Texel coordinate, on one axis, of light-plane coordinate `u` in the clipmap of `level` whose
     *  first page is `origin`: relative to that page, whose world offset is exact in f32. */
    shadowSunMapTexel: (u: V, origin: V, level: V) =>
      o.div(o.sub(u, o.mul(o.toFloat(origin), o.mul(texel(level), page))), texel(level)),
    /** Page, on one axis, of map texel `t`. */
    shadowPageOfTexel: (t: V) => o.toInt(o.floor(o.div(t, page))),
    /** World side of a texel of a lamp face's finest mip at `radius` from the lamp, its field of
     *  half-angle tangent `tanHalf`. */
    shadowLampFinestTexel: (tanHalf: V, radius: V) =>
      o.div(o.mul(o.mul(o.float(2), tanHalf), radius), o.float(LAMP_SIDE * SHADOW_PAGE)),
    /** The mip a pixel of footprint `footprint` reads: the one whose texel it covers. */
    shadowLampReadMip: (footprint: V, texel0: V) =>
      o.toInt(
        o.clamp(
          o.floor(o.log2(o.max(o.div(footprint, texel0), o.float(1)))),
          o.float(0),
          o.float(LAMP_MIPS - 1),
        ),
      ),
    /** Texel coordinate, on one axis, of normalised device coordinate `ndc` in a face mip `side`
     *  texels wide: `ndc` rightward, or the negated one downward. */
    shadowLampMapTexel: (ndc: V, side: V) =>
      o.mul(o.add(o.mul(ndc, o.float(0.5)), o.float(0.5)), side),
    /** 1 when the PCF around texel `t` of the page starting at texel `first` reads the neighbour
     *  across an edge on that axis, else 0. */
    shadowPcfEdge: (t: V, first: V) =>
      o.pick(
        o.or(o.lt(o.sub(t, reach), first), o.ge(o.add(t, reach), o.add(first, page))),
        o.int(1),
        o.int(0),
      ),
    /** Low edge, in normalised face coordinates, of page `x` of a face `pages` wide (`regionRect`);
     *  the edge on the other axis is the high one negated, `y` going down. */
    shadowRegionLow: (pages: V, x: V) => o.sub(o.div(o.mul(o.float(2), x), pages), o.float(1)),
    /** High edge of page `x`, the low edge of the next. */
    shadowRegionHigh: (pages: V, x: V) =>
      o.sub(o.div(o.mul(o.float(2), o.add(x, o.float(1))), pages), o.float(1)),
    /** Scale and offset, on one axis, that crop a face's clip square to `[low, high]`: the page
     *  then fills the clip square (`writeLampPage`). */
    shadowCropScale: (low: V, high: V) => o.div(o.float(2), o.sub(high, low)),
    shadowCropOffset: (low: V, high: V) => o.div(o.neg(o.add(low, high)), o.sub(high, low)),
    /** Light-plane centre, on one axis, of a square of `cells` sun pages of `metres` from page `x`:
     *  where a page draw's eye stands (`writeSunSquare`), `y` going down. */
    shadowSunSquareCentre: (x: V, cells: V, metres: V) =>
      o.mul(o.add(x, o.div(cells, o.float(2))), metres),
    /** Clip coordinate, on one axis, of the centre of the page whose first texel is `origin` in a
     *  layer `size` texels wide: where a page's square lies in the pool's clip square, `y` negated. */
    shadowAtlasClip: (origin: V, size: V) =>
      o.sub(o.div(o.add(o.mul(o.float(2), origin), page), size), o.float(1)),
    /** Toward which neighbour, on that axis, the PCF around `t` reads: 1 up, −1 down. */
    shadowPcfStep: (t: V, first: V) =>
      o.pick(o.ge(o.sub(t, first), o.float(SHADOW_PAGE / 2)), o.int(1), o.int(-1)),
    ...pageViewModel(o),
    ...pageKeyModel(o, shadowEntrySpan(shadowTableEntries(windowPages))),
  };
}

export type PageModel<V> = ReturnType<typeof pageModel<V>>;

/** The page model on numbers: what the scheduler computes. */
export const PAGES = /* @__PURE__ */ pageModel(NUMBERS);

/** Non-negative remainder. */
export const ringOf = (v: number, n: number) => PAGES.shadowRing(v, n);

/** Entry of sun page `(ax, ay)` of level `level`, relative to the light's table base, for a
 *  clipmap extent of `pages` a side — the session's, the constant by default. */
export const sunEntry = (level: number, ax: number, ay: number, pages = SUN_WINDOW) =>
  PAGES.shadowRing(level, SUN_LEVELS) * pages * pages + PAGES.shadowRingPageEntry(pages, ax, ay);

/** Entry of lamp page `(x, y)` of `face` at `mip`, relative to the light's table base. */
export const lampEntry = (face: number, mip: number, x: number, y: number) =>
  PAGES.shadowLampMapEntry(face, mip) +
  PAGES.shadowFacePageEntry(PAGES.shadowLampMipPages(mip), x, y);

/** How coarse a sun level or a lamp mip is within its light (`shadowSunCoarseness`). */
export const sunCoarseness = (level: number, finest: number) =>
    PAGES.shadowSunCoarseness(level, finest),
  lampCoarseness = (mip: number) => PAGES.shadowLampCoarseness(mip);

/** Side of a sun page at `level`, in metres: `SHADOW_PAGE` texels of `2^level`. */
export const sunPageMetres = (level: number) => PAGES.shadowSunTexelMetres(level) * SHADOW_PAGE;

/**
 * The finest level a pixel of this view can read: the texel at most the size of its footprint
 * at the near plane. Every finer level would be sharper than any pixel that reads it.
 */
export const finestSunLevel = (footprint: number) => PAGES.shadowSunLevelOf(footprint);
