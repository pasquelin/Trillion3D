import {
  LAMP_FACE_ENTRIES,
  LAMP_MIPS,
  LAMP_SIDE,
  SHADOW_PAGE,
  SUN_LEVELS,
  SUN_LEVEL_ENTRIES,
  SUN_WINDOW,
} from './virtual.ts';

/**
 * THE PAGE MODEL: where a page's word sits in the table, which level or mip a pixel reads, which
 * page a map texel lies in and which neighbours the PCF reads around it. Each formula is written
 * once, over `PageOps`: evaluated on numbers it is the scheduler's, printed as WGSL it is the
 * shaders' (`PAGE_MODEL_WGSL`) — one source, so the two can never address a page differently.
 */
export interface PageOps<V> {
  int(n: number): V;
  float(n: number): V;
  add(a: V, b: V): V;
  sub(a: V, b: V): V;
  mul(a: V, b: V): V;
  /** Of floats, or of integers that divide exactly. */
  div(a: V, b: V): V;
  mod(a: V, b: V): V;
  shr(a: V, b: V): V;
  max(a: V, b: V): V;
  clamp(a: V, low: V, high: V): V;
  floor(a: V): V;
  log2(a: V): V;
  exp2(a: V): V;
  toInt(a: V): V;
  toFloat(a: V): V;
  lt(a: V, b: V): V;
  ge(a: V, b: V): V;
  or(a: V, b: V): V;
  pick(when: V, yes: V, no: V): V;
}

/** Texels around a read point that the PCF's bilinear footprints reach, on each axis: a point
 *  nearer a page's edge than this reads the neighbour across it (`shadowPcf`). */
export const PCF_EDGE_TEXELS = 1.5;

/** The page formulas over `o`, by their WGSL names. */
export function pageModel<V>(o: PageOps<V>) {
  const ring = (v: V, n: V) => o.mod(o.add(o.mod(v, n), n), n);
  const texel = (level: V) => o.exp2(o.toFloat(level));
  const page = o.float(SHADOW_PAGE),
    reach = o.float(PCF_EDGE_TEXELS);
  const levelOf = (footprint: V) => o.toInt(o.floor(o.log2(o.max(footprint, o.float(1e-30)))));
  return {
    /** Non-negative remainder of `v` by `n`. */
    shadowRing: ring,
    /** Entry of absolute page `(x, y)` in a ring window of `pages²` entries. */
    shadowRingPageEntry: (pages: V, x: V, y: V) =>
      o.add(o.mul(ring(y, pages), pages), ring(x, pages)),
    /** Entry of page `(x, y)` of a map `pages` wide, row by row. */
    shadowFacePageEntry: (pages: V, x: V, y: V) => o.add(o.mul(y, pages), x),
    /** First entry of sun `level`: its slot in the ring of `SUN_LEVELS`. */
    shadowSunLevelEntry: (level: V) =>
      o.mul(ring(level, o.int(SUN_LEVELS)), o.int(SUN_LEVEL_ENTRIES)),
    /** First entry of `mip` of lamp `face`: the faces before it, then its finer mips — `S²`, `S²/4`,
     *  … pages, `4 (S² − p²) / 3` together for `p = S >> mip`, exact for a side `S` a power of two. */
    shadowLampMapEntry: (face: V, mip: V) => {
      const pages = o.shr(o.int(LAMP_SIDE), mip);
      const finer = o.sub(o.int(LAMP_SIDE * LAMP_SIDE), o.mul(pages, pages));
      return o.add(o.mul(face, o.int(LAMP_FACE_ENTRIES)), o.div(o.mul(o.int(4), finer), o.int(3)));
    },
    /** The sun level whose texel, `2^L` metres, is at most `footprint`. */
    shadowSunLevelOf: levelOf,
    /** The level a pixel of footprint `footprint` reads: its own, never finer than `finest`. */
    shadowSunReadLevel: (footprint: V, finest: V) => o.max(levelOf(footprint), finest),
    /** Side of a texel of sun `level`, in metres. */
    shadowSunTexelMetres: texel,
    /** Texel coordinate, on one axis, of light-plane coordinate `u` in the window of `level` whose
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
    /** Toward which neighbour, on that axis, the PCF around `t` reads: 1 up, −1 down. */
    shadowPcfStep: (t: V, first: V) =>
      o.pick(o.ge(o.sub(t, first), o.float(SHADOW_PAGE / 2)), o.int(1), o.int(-1)),
  };
}

export type PageModel<V> = ReturnType<typeof pageModel<V>>;

const NUMBERS: PageOps<number> = {
  int: (n) => n,
  float: (n) => n,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  mod: (a, b) => a % b,
  shr: (a, b) => a >> b,
  max: (a, b) => Math.max(a, b),
  clamp: (a, low, high) => Math.min(Math.max(a, low), high),
  floor: Math.floor,
  log2: Math.log2,
  exp2: (a) => 2 ** a,
  toInt: Math.trunc,
  toFloat: (a) => a,
  lt: (a, b) => +(a < b),
  ge: (a, b) => +(a >= b),
  or: (a, b) => +(a || b),
  pick: (when, yes, no) => (when ? yes : no),
};

/** The page model on numbers: what the scheduler computes. */
export const PAGES = pageModel(NUMBERS);

/** Non-negative remainder. */
export const ringOf = PAGES.shadowRing;

/** Entry of sun page `(ax, ay)` of level `level`, relative to the light's table base. */
export const sunEntry = (level: number, ax: number, ay: number) =>
  PAGES.shadowSunLevelEntry(level) + PAGES.shadowRingPageEntry(SUN_WINDOW, ax, ay);

/** First entry of `mip` inside a lamp face. */
export const lampMipOffset = (mip: number) => PAGES.shadowLampMapEntry(0, mip);

/** Entry of lamp page `(x, y)` of `face` at `mip`, relative to the light's table base. */
export const lampEntry = (face: number, mip: number, x: number, y: number) =>
  PAGES.shadowLampMapEntry(face, mip) + PAGES.shadowFacePageEntry(LAMP_SIDE >> mip, x, y);

/** Side of a sun page at `level`, in metres: `SHADOW_PAGE` texels of `2^level`. */
export const sunPageMetres = (level: number) => PAGES.shadowSunTexelMetres(level) * SHADOW_PAGE;

/**
 * The finest level a pixel of this view can read: the texel at most the size of its footprint
 * at the near plane. Every finer level would be sharper than any pixel that reads it.
 */
export const finestSunLevel = PAGES.shadowSunLevelOf;

/** The pages the PCF around map texel `t` reads, its home page `home` first: the neighbours
 *  across the one or two edges it comes near (`shadowPcf`). */
export function pcfPages(t: ArrayLike<number>, home: ArrayLike<number>) {
  const first = [home[0] * SHADOW_PAGE, home[1] * SHADOW_PAGE],
    edge = [0, 1].map((a) => PAGES.shadowPcfEdge(t[a], first[a])),
    step = [0, 1].map((a) => PAGES.shadowPcfStep(t[a], first[a]));
  const read = [[home[0], home[1]]];
  if (edge[0]) read.push([home[0] + step[0], home[1]]);
  if (edge[1]) read.push([home[0], home[1] + step[1]]);
  if (edge[0] && edge[1]) read.push([home[0] + step[0], home[1] + step[1]]);
  return read;
}
