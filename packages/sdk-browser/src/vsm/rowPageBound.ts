/**
 * How many caster rows a chunk of the shadow raster takes (`renderPass.ts`, `transmissionPass.ts`),
 * from where the rows are: the most K such that ANY K rows make at most `cap` (row, page) pairs and
 * `cap` commands. The candidates fill a chunk in the GPU's order, so K holds for the K rows of the
 * largest bounds — a chunk of any K never exceeds it, no list overflows, no page is missed.
 *
 * A row's pairs (`vsmRenderCull` → `vsmRenderExpand`): one per page of each command's rect, one
 * command per (view, mip) whose box the row's box meets. On a clipmap level — an orthographic
 * square of half-width hw, 128 pages a side, around its snapped centre — the row's light-space box
 * (half-extent ≤ r·√3: the cull's |e·m₀|+|e·m₁|+|e·m₂| of a unit rotation) meets the level only
 * when its Chebyshev distance to the centre, less that half-extent, is ≤ hw, and there it spans
 * at most ceil(2e/page) + 1 pages an axis (`floor(b) − floor(a) ≤ ceil(b − a)`; the rect's ±½
 * pixels only shrink it, its clamps too). A row makes at most one pair per physical page (each
 * backs one (map, mip, page)): at most `pages`. A local light's full map is bounded by `pages`, a
 * single-page map by its one page.
 *
 * Cheap: per sun, the rows are binned once by (s, e) — s the light-space Chebyshev distance to a
 * reference point less e — and the rows each upload writes re-binned (`VsmRowSpheres.written`). A
 * level whose box reaches T = hw + |centre − reference|∞ from the reference holds only rows of
 * s ≤ T: a frame reads the bins, not the rows, and a frame whose levels and bins did not move
 * reads nothing. The reference is the camera when binned. When the camera's travel would cost a
 * chunk more than it did then, new bins around it are made a slice of rows a frame while the old
 * ones — a bound for any camera — keep bounding, and replace them once whole: never a frame's
 * hitch. While the sun turns, the worst case is kept; it is binned anew once its axes held still
 * a frame.
 *
 * A local light's full maps, by the same bins around the light, along its maps' clip rows (a spot's
 * x, y, w; a point light's world axes, its faces' permutations of them): s the least Chebyshev
 * distance of the row's clip box, e its half-extent and room. The cull drops a row past the range
 * (|d| ≥ s − e) and, for a spot, one whose box leaves the pyramid (max(|x|,|y|) − w > 2e: binned
 * past every range). Elsewhere the box's least depth is ≥ s − 2e (a visible box has
 * max(|x|,|y|) ≤ w + 2e); when positive, its rect spans ≤ 4e / (s − 2e) of NDC an axis (the ±1
 * clamp only shrinks it) — at most ceil(span · N/2) + 1 pages of a mip's N — and a point light's
 * row meets at most 3 faces (two opposite need depth ≤ 0); else every page of every face. The
 * lights are binned together (`Joint`): each row's pairs and commands summed over them, rounded up
 * to a bin's edge, 2 bytes a row in all — so the K heaviest rows are counted once, not once a
 * light. The bins hold while the lights hold still (their maps' signature, read each frame); when
 * one moves they keep the worst case, and once they held still a frame the bins are made anew, a
 * slice a frame. When even the rows binned so far make more than `cap` in the worst case's chunk
 * plus one row, the bins cannot beat it: they are dropped until the lights change.
 *
 * No frame bins every row at once: a sun's first bins, and those after it turned or after an upload
 * the bins could not follow, are made a slice a frame too, the worst case kept meanwhile.
 */
import { CLUSTER_SPHERE_FLOATS as STRIDE } from '../gpu/shadow/sphereContract.ts';
import type { VsmClipmap } from './clipmap.ts';
import { VSM_LEVEL0_PAGES, VSM_MIPS } from './constants.ts';
import { sameValues } from '../math/matrixElements.ts';
import type { VsmLightAllocation } from './frameSetup.ts';
import { ceilDiv } from './layout.ts';

/** The CPU copy of the rows' world spheres (`webgpu/shadow/spheres.ts`): centre high, radius,
 *  centre low, pad, per row; and the row runs `[from, to]` (flat pairs) its upload `epoch` wrote. */
export interface VsmRowSpheres {
  packed: Float32Array;
  written: { epoch: number; runs: readonly number[] };
}

/** The lights as the bound reads them: a sun's clipmap, a local light's single page or its maps'
 *  projection data (`entry`). */
export type VsmBoundLight = Pick<
  VsmLightAllocation,
  'kind' | 'firstId' | 'count' | 'shouldRender'
> &
  Partial<Pick<VsmLightAllocation, 'singlePage' | 'clipmap' | 'entry'>>;

/** A chunk of the raster: its rows, and the most commands and pairs any k rows make. */
export interface VsmChunk {
  rows: number;
  cmds: (k: number) => number;
  pairs: (k: number) => number;
}

/** The worst case: `rows` a chunk, every row `cmdsPerRow` commands and every one of `pages`. */
export const vsmWorstChunk = (rows: number, cmdsPerRow: number, pages: number): VsmChunk => ({
  rows,
  cmds: (k) => k * cmdsPerRow,
  pairs: (k) => k * pages,
});

/** Relative room for the GPU's f32 cull: its roundings (2⁻²⁴ each, on magnitudes below the row's
 *  distance to the level centre plus its extent) stay below 2⁻¹⁶ of them while fewer than 256. */
const ROOM = 2 ** -16;
const SQRT3 = Math.sqrt(3);
const SIDE = VSM_LEVEL0_PAGES;
// Bins: s in quarter octaves from 1 mm (bin 0 below: inside or touching), e in half octaves, read
// from the f32 bits — exponent, then the mantissa's top bits: the edges are the floats whose lower
// bits are zero. Their width only loosens the bound: a row's bin has least s ≤ its s and greatest
// e ≥ its e (s rounded down, e up, before they are read as f32).
const S_BINS = 128,
  E_BINS = 64,
  UNIT = 2 ** -10;
const bitsOf = (v: number) => new Int32Array(Float32Array.of(v).buffer)[0];
const ofBits = (bits: number) => new Float32Array(Int32Array.of(bits).buffer)[0];
const UNIT_BITS = bitsOf(UNIT);
/** The least s of bin j: quarter octaves, the mantissa's two top bits (shift 21). */
const sLeast = Float64Array.from({ length: S_BINS }, (_, j) =>
  j === 0 ? -Infinity : ofBits(UNIT_BITS + ((j - 1) << 21)),
);
/** The greatest e of bin k: half octaves, the mantissa's top bit (shift 22). */
const eMost = Float64Array.from({ length: E_BINS }, (_, k) =>
  k === E_BINS - 1 ? Infinity : ofBits(UNIT_BITS + (k << 22)),
);
const S_TOP = sLeast[S_BINS - 1],
  E_TOP = eMost[E_BINS - 2],
  DOWN = 1 - 2 ** -23,
  UP = 1 + 2 ** -23;
/** Rows binned a block at a time: their s and e as f32, then as bits. */
const BLOCK = 2048;
const blockS = new Float32Array(BLOCK),
  blockE = new Float32Array(BLOCK),
  bitsS = new Int32Array(blockS.buffer),
  bitsE = new Int32Array(blockE.buffer);

/** How a light's rows are binned: three world axes (a sun's third is zero), the half-extent along
 *  them per unit of radius, the scale of the f32 room of the row's distance, and whether rows that
 *  leave a spot's pyramid are binned past every range. */
interface Shape {
  axes: Float64Array;
  spread: number;
  roomScale: number;
  cone: boolean;
}

/** The world directions of a clipmap's light-space x and y axes. */
const axesOf = (m: ArrayLike<number>, out: Float64Array = new Float64Array(6)) => {
  for (let k = 0; k < 3; k++) {
    out[k] = m[k * 4];
    out[3 + k] = m[k * 4 + 1];
  }
  return out;
};
const dot = (a: Float64Array, at: number, x: number, y: number, z: number) =>
  a[at] * x + a[at + 1] * y + a[at + 2] * z;

/** Rows binned around a reference point: how many in each bin, each row's bin, and the rows
 *  `[first, cursor)` binned so far. */
interface Binned {
  /** The reference point, world, split as the spheres are (high f32, low). */
  ref: Float64Array;
  counts: Uint32Array;
  /** Each row's bin, `first` its rank 0. */
  bins: Uint16Array;
  cursor: number;
}
const binned = (): Binned => ({
  ref: new Float64Array(6),
  counts: new Uint32Array(S_BINS * E_BINS),
  bins: new Uint16Array(0),
  cursor: 0,
});

/** One sun's rows, binned along its light-space axes in two sets kept for good: `held[now]` the
 *  bins the bound reads (whole: its cursor at the range's end), the other the bins a moved camera
 *  is getting while `making`. */
interface SunRows {
  clipmap: VsmClipmap;
  /** Its light-space x and y, binned with the cull's extent bound r·√3. */
  shape: Shape;
  held: [Binned, Binned];
  now: 0 | 1;
  /** `held[now]` whole: until then the sun bounds nothing. */
  ready: boolean;
  making: boolean;
  /** The axes of the frame before: the sun turns while they differ from this frame's. */
  seen: Float64Array;
}
const nowOf = (sun: SunRows) => sun.held[sun.now];

/** A full-map local light as the joint bins read it (`localKey`): its binning, its position split
 *  as the spheres are, and per bin the pairs and faces a row of it makes (`lampTables`). */
interface Lamp {
  shape: Shape;
  ref: Float64Array;
  pairs: Float32Array;
  meets: Uint8Array;
}

/** The full-map local lights' rows, binned together (`jointRows`): per row a pairs bin and a
 *  commands bin (2 bytes); the lights' signature and keys as last read; the keys binned; the
 *  weight of the k heaviest rows, pairs then commands (`jointWeights`). */
interface Joint {
  state: 'none' | 'making' | 'whole' | 'hopeless';
  lamps: Lamp[];
  maps: unknown[];
  sign: Float64Array;
  known: boolean;
  keys: Float64Array;
  binned: Float64Array;
  pairs: Uint32Array;
  meets: Uint32Array;
  tops: [Ascending, Ascending];
  bins: Uint16Array;
  cursor: number;
}
const joint = (): Joint => {
  const pairs = new Uint32Array(PAIR_EDGES.length),
    meets = new Uint32Array(MEET_EDGES.length);
  return {
    state: 'none',
    lamps: [],
    maps: [],
    sign: new Float64Array(0),
    known: false,
    keys: new Float64Array(0),
    binned: new Float64Array(0),
    pairs,
    meets,
    tops: [new Ascending(pairs, PAIR_EDGES, 1), new Ascending(meets, MEET_EDGES, VSM_MIPS)],
    bins: new Uint16Array(0),
    cursor: 0,
  };
};

/** A pass's bound: its suns' and local lights' bins, the rows they hold, and its last answer. */
export interface VsmRowBound {
  suns: SunRows[];
  lamps: Joint;
  spheres?: VsmRowSpheres;
  epoch: number;
  first: number;
  end: number;
  /** The chunks the bound gave right after its bins were last made. */
  binnedChunks: number;
  /** The last answer and what it was measured from (`measureKey`), the bins unchanged since. */
  held?: { chunk: VsmChunk; key: Float64Array };
  /** What `measure` reuses, so a moving frame allocates nothing: see `Scratch`. */
  scratch: Scratch;
  /** Rows a frame bins toward a moved camera's bins (`VSM_BOUND_SLICE_ROWS`). */
  slice: number;
}
export const createVsmRowBound = (): VsmRowBound => ({
  scratch: scratchOf(),
  suns: [],
  lamps: joint(),
  epoch: 0,
  first: 0,
  end: 0,
  binnedChunks: 0,
  slice: VSM_BOUND_SLICE_ROWS,
});

/** The s and e of rows `[start, start + n)` of `p` by `shape` around `ref`, as f32 in the block
 *  (`binOf`): each row's s widened and its e grown by the f32 room of its distance to `ref`. */
function binBlock(ref: Float64Array, shape: Shape, p: Float32Array, start: number, n: number) {
  const { spread, roomScale, cone } = shape;
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = shape.axes,
    [h0, h1, h2, l0, l1, l2] = ref;
  for (let i = 0, at = start * STRIDE; i < n; i++, at += STRIDE) {
    const dx = p[at] - h0 + (p[at + 4] - l0),
      dy = p[at + 1] - h1 + (p[at + 5] - l1),
      dz = p[at + 2] - h2 + (p[at + 6] - l2);
    const x = a0 * dx + a1 * dy + a2 * dz,
      y = a3 * dx + a4 * dy + a5 * dz,
      z = a6 * dx + a7 * dy + a8 * dz;
    const r = p[at + 3] * spread,
      e = r + ROOM * (roomScale * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) + r);
    const reach = Math.max(Math.abs(x), Math.abs(y));
    // Out of a spot's pyramid: past every range.
    const least = cone && reach - z > 2 * e ? Infinity : Math.max(reach, Math.abs(z)) - e - (e - r);
    // NaN reads as the loosest: s as below every edge, e as above.
    blockS[i] = least >= UNIT ? Math.min(least, S_TOP) * DOWN : 0;
    blockE[i] = e < E_TOP ? e * UP : E_TOP;
  }
}
/** The bin of the block's row `i`: its s rounded down, its e up, read from their f32 bits. */
function binOf(i: number) {
  const j = (bitsS[i] - UNIT_BITS) >> 21,
    k = (bitsE[i] - UNIT_BITS) >> 22;
  return (j < 0 ? 0 : j + 1) * E_BINS + (k < 0 ? 0 : k + 1);
}

/** Bins rows `[from, to)` of `p` into `b` by `shape`. No allocation: a block goes through f32. */
function binRows(
  b: Binned,
  shape: Shape,
  p: Float32Array,
  from: number,
  to: number,
  first: number,
) {
  for (let start = from; start < to; start += BLOCK) {
    const n = Math.min(BLOCK, to - start);
    binBlock(b.ref, shape, p, start, n);
    for (let i = 0, at = start - first; i < n; i++, at++) b.counts[(b.bins[at] = binOf(i))]++;
  }
}
function unbinRows(b: Binned, from: number, to: number, first: number) {
  for (let row = from; row < to; row++) b.counts[b.bins[row - first]]--;
}

/** Starts `b` around `origin` (the camera) with no row of `[first, …)` binned, its arrays kept. */
function start(b: Binned, origin: ArrayLike<number>, first: number, rows: number) {
  splitRef(b.ref, origin);
  b.counts.fill(0);
  if (b.bins.length < rows) b.bins = new Uint16Array(rows);
  b.cursor = first;
}

/** `origin` split as the spheres are: high f32, low. */
function splitRef(ref: Float64Array, origin: ArrayLike<number>) {
  for (let k = 0; k < 3; k++) {
    ref[k] = Math.fround(origin[k]);
    ref[3 + k] = origin[k] - ref[k];
  }
  return ref;
}

/** Bins `b` on to row `to`. */
function catchUp(b: Binned, shape: Shape, bound: VsmRowBound, to: number) {
  binRows(b, shape, bound.spheres!.packed, b.cursor, to, bound.first);
  b.cursor = to;
}

/** Rows a frame bins toward a moved camera's bins: at the binning's ~6 ns a row (Node, 189 000
 *  rows in ~1.1 ms), ~0.1 ms — no more than the frame's own measure of the bound (0.1–0.25 ms): a
 *  re-bin for tightness never costs a frame; the old bins bound the rows meanwhile. */
const VSM_BOUND_SLICE_ROWS = 1 << 14;

/** Brings rows binned up to `cursor` to `[first, end)`: the written rows below it unbinned and
 *  binned again, those past `end` unbinned; the cursor it leaves. */
function followRows(
  cursor: number,
  runs: readonly number[] | undefined,
  end: number,
  first: number,
  unbin: (from: number, to: number) => void,
  rebin: (from: number, to: number) => void,
) {
  if (runs)
    for (let r = 0; r < runs.length; r += 2) {
      const from = Math.max(runs[r], first),
        to = Math.min(runs[r + 1] + 1, cursor);
      if (from >= to) continue;
      unbin(from, to);
      rebin(from, to);
    }
  if (cursor > end) unbin(end, cursor);
  return Math.min(cursor, end);
}
/** `followRows` of a sun's bins. */
function followSet(
  b: Binned,
  shape: Shape,
  p: Float32Array,
  runs: readonly number[] | undefined,
  first: number,
  end: number,
) {
  b.cursor = followRows(
    b.cursor,
    runs,
    end,
    first,
    (from, to) => unbinRows(b, from, to, first),
    (from, to) => binRows(b, shape, p, from, to, first),
  );
}

/** Brings the bins in use — those read, those being made — to rows `[first, end)` of
 *  `spheres`; the bins read then bin the rows the range gained, the others bin them as they go.
 *  The suns' are left when `suns` is false (they are binned anew). False when they cannot follow
 *  (another copy, another first row, an upload not seen): every row is binned again. */
function follow(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  first: number,
  end: number,
  suns: boolean,
) {
  const { epoch } = spheres.written;
  if (bound.spheres !== spheres || bound.first !== first) return false;
  if (epoch !== bound.epoch && epoch !== bound.epoch + 1) return false;
  const runs = epoch !== bound.epoch ? spheres.written.runs : undefined,
    p = spheres.packed;
  for (const sun of suns ? bound.suns : []) {
    if (sun.making) followSet(sun.held[sun.now ^ 1], sun.shape, p, runs, first, end);
    followSet(nowOf(sun), sun.shape, p, runs, first, end);
    if (sun.ready) catchUp(nowOf(sun), sun.shape, bound, end);
  }
  const moved = runs !== undefined || bound.end !== end,
    lamps = bound.lamps;
  if (lamps.state === 'making' || lamps.state === 'whole') {
    lamps.cursor = followRows(
      lamps.cursor,
      runs,
      end,
      first,
      (from, to) => unbinJoint(lamps, from, to, first),
      (from, to) => jointRows(lamps, p, from, to, first),
    );
    if (lamps.state === 'whole') catchUpJoint(lamps, bound, end);
  }
  if (moved) bound.held = undefined;
  bound.epoch = epoch;
  bound.end = end;
  return true;
}

/** Starts every sun's rows anew, around the camera, a slice a frame (`advance`): first sight, a
 *  sun that turned, rows not followed — then the local lights' bins are made anew too. */
function bin(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number },
  followed: boolean,
) {
  const { first, end } = range;
  Object.assign(bound, { spheres, first, end, epoch: spheres.written.epoch, held: undefined });
  for (const sun of bound.suns) {
    axesOf(sun.clipmap.lightViewRotation, sun.shape.axes);
    start(nowOf(sun), sun.clipmap.eyeWorld, first, rowsOf(bound));
    sun.ready = sun.making = false;
  }
  const lamps = bound.lamps;
  if (!followed && (lamps.state === 'making' || lamps.state === 'whole')) startJoint(bound);
}

/** One slice more — `bound.slice` rows a frame in all, a row of the lights' bins counting once a
 *  light — of the bins being made: a sun's first ones (it bounds nothing until whole), the
 *  lights' when they may pay (more rows than the worst case's chunk), then a sun's around a
 *  moved camera. True when bins became whole. */
function advance(bound: VsmRowBound, pays: boolean) {
  let replaced = false,
    budget = bound.slice;
  for (const sun of bound.suns) {
    if (sun.ready) continue;
    budget -= slice(nowOf(sun), sun.shape, bound, budget);
    if ((sun.ready = nowOf(sun).cursor >= bound.end)) replaced = true;
  }
  const lamps = bound.lamps;
  if (lamps.state === 'making' && pays && budget > 0) {
    const from = lamps.cursor,
      per = Math.max(1, lamps.lamps.length);
    catchUpJoint(lamps, bound, Math.min(bound.end, from + Math.max(1, Math.floor(budget / per))));
    budget -= (lamps.cursor - from) * per;
    if (lamps.cursor >= bound.end) {
      lamps.state = 'whole';
      replaced = true;
    }
  }
  for (const sun of bound.suns) {
    if (!sun.making || budget <= 0) continue;
    const next = sun.held[sun.now ^ 1];
    budget -= slice(next, sun.shape, bound, budget);
    if (next.cursor < bound.end) continue;
    sun.now ^= 1;
    sun.making = false;
    replaced = true;
  }
  if (replaced) bound.held = undefined;
  return replaced;
}
/** Bins at most `budget` rows more of `b`; the rows it binned. */
function slice(b: Binned, shape: Shape, bound: VsmRowBound, budget: number) {
  const from = b.cursor;
  catchUp(b, shape, bound, Math.min(bound.end, from + budget));
  return b.cursor - from;
}

/** Rows of the bound's copy from its first. */
const rowsOf = (bound: VsmRowBound) => bound.spheres!.packed.length / STRIDE - bound.first;

/** Each sun starts making bins around this frame's camera, unless it is already. */
function startMaking(bound: VsmRowBound) {
  const rows = rowsOf(bound);
  for (const sun of bound.suns) {
    if (sun.making) continue;
    start(sun.held[sun.now ^ 1], sun.clipmap.eyeWorld, bound.first, rows);
    sun.making = true;
  }
}

/** The suns of this frame's clipmaps, the bins of those gone dropped; undefined while one turns
 *  (its axes moved since the frame before), true when one must be binned (new or turned). */
function sunsOf(bound: VsmRowBound, clipmaps: readonly VsmClipmap[]) {
  let rebin = bound.suns.length !== clipmaps.length,
    turning = false;
  const suns = clipmaps.map((clipmap) => {
    const sun =
      bound.suns.find((s) => s.clipmap === clipmap) ??
      ({
        clipmap,
        shape: {
          axes: new Float64Array(9).fill(NaN, 0, 6),
          spread: SQRT3,
          roomScale: 1,
          cone: false,
        },
        held: [binned(), binned()],
        now: 0,
        ready: false,
        making: false,
        seen: new Float64Array(6).fill(NaN),
      } satisfies SunRows);
    const now = axesOf(clipmap.lightViewRotation, axesScratch);
    if (now.some((v, i) => v !== sun.shape.axes[i])) {
      rebin = true;
      if (now.some((v, i) => v !== sun.seen[i])) turning = true;
    }
    sun.seen.set(now);
    return sun;
  });
  bound.suns = suns;
  return turning ? undefined : rebin;
}
const axesScratch = new Float64Array(6);

/** A local light's key: its axes (9 words), then the words below. */
const AT_SPREAD = 9,
  AT_CONE = 10,
  AT_POSITION = 11,
  AT_RANGE = 14,
  KEY = 15;
/** A clip row of `uv` (`vsmShiftedToClip`: x = 2u − w, y = w − 2v, w), its world x, y, z
 *  then its translation. */
const clipRow = (uv: ArrayLike<number>, row: 0 | 1 | 3, k: number) =>
  row === 0
    ? 2 * uv[k * 4] - uv[k * 4 + 3]
    : row === 1
      ? uv[k * 4 + 3] - 2 * uv[k * 4 + 1]
      : uv[k * 4 + 3];
const ROWS = [0, 1, 3] as const;

/** A spot's axes — its map's clip rows x, y, w — into `out`'s first nine words; the greatest L1
 *  norm of those rows, or -1 when one has a translation. */
function spotAxes(uv: ArrayLike<number>, out: Float64Array) {
  let spread = 0;
  for (const row of ROWS) {
    if (clipRow(uv, row, 3) !== 0) return -1;
    let l1 = 0;
    for (let k = 0; k < 3; k++) {
      const v = clipRow(uv, row, k);
      out[(row === 3 ? 2 : row) * 3 + k] = v;
      l1 += Math.abs(v);
    }
    spread = Math.max(spread, l1);
  }
  return spread;
}

/** A point light's axes — the world axes scaled by the least of its six maps' clip rows — into
 *  `out`'s first nine words; the greatest L1 norm of those rows, or -1 when the maps are not a
 *  cube's faces: a row with a translation or reading two world axes, a face missing an axis, or
 *  the six depths not ± each axis once. */
function cubeAxes(
  maps: readonly { projectionData: { shiftedToMapUv: ArrayLike<number> } }[],
  out: Float64Array,
) {
  let spread = 0,
    least = Infinity,
    depths = 0;
  for (let m = 0; m < 6; m++) {
    const uv = maps[m].projectionData.shiftedToMapUv;
    let columns = 0;
    for (const row of ROWS) {
      if (clipRow(uv, row, 3) !== 0) return -1;
      let l1 = 0,
        most = 0,
        column = 0;
      for (let k = 0; k < 3; k++) {
        const v = Math.abs(clipRow(uv, row, k));
        l1 += v;
        if (v > most) {
          most = v;
          column = k;
        }
      }
      if (l1 !== most || most === 0) return -1;
      spread = Math.max(spread, l1);
      least = Math.min(least, most);
      columns |= 1 << column;
      if (row === 3) depths |= 1 << (column * 2 + (clipRow(uv, row, column) > 0 ? 1 : 0));
    }
    if (columns !== 7) return -1;
  }
  if (depths !== 63) return -1;
  out.fill(0, 0, 9);
  for (let k = 0; k < 3; k++) out[k * 4] = least;
  return spread;
}

/**
 * The key a full-map local light is binned by (`KEY`), or false when its maps are not what the
 * bound reads: no translation in their clip rows (the light at the translated origin), and a
 * spot's one map (its clip rows, its pyramid) or a point light's six, whose rows each read one
 * world axis, every face's three a permutation of them and the six depths ± each axis once (the
 * world axes scaled by the least row, so no face reads a smaller Chebyshev distance).
 */
function localKey(light: VsmBoundLight, out: Float64Array) {
  const maps = light.entry?.mapCaches,
    spot = light.kind === 'spot',
    count = spot ? 1 : 6;
  if (!maps || light.count !== count || maps.length < count) return false;
  const data = maps[0].projectionData;
  const spread = spot ? spotAxes(data.shiftedToMapUv, out) : cubeAxes(maps, out);
  if (spread < 0) return false;
  out[AT_SPREAD] = spread;
  out[AT_CONE] = spot ? 1 : 0;
  for (let k = 0; k < 3; k++) out[AT_POSITION + k] = -data.originShift[k];
  out[AT_RANGE] = data.lightRange;
  return true;
}

/** Words of a light's signature (`signed`): its map count, position, range, first map's UV. */
const SIGN = 21;
/**
 * Whether the full-map local lights changed since the frame before — another list, another
 * light, or a light whose position, range or first map's matrix moved (a point light's faces
 * follow its range) — the signature kept for the next frame. Cheap: no key is made.
 */
function signed(lamps: Joint, lights: readonly VsmBoundLight[]) {
  let changed = false;
  if (lamps.sign.length !== lights.length * SIGN) {
    lamps.sign = new Float64Array(lights.length * SIGN);
    changed = true;
  }
  const sign = lamps.sign;
  for (let i = 0; i < lights.length; i++) {
    const maps = lights[i].entry?.mapCaches,
      at = i * SIGN;
    changed = put(sign, at, lights[i].count) || changed;
    if (lamps.maps[i] !== maps) {
      lamps.maps[i] = maps;
      changed = true;
    }
    const data = maps?.[0]?.projectionData;
    if (!data) continue;
    for (let k = 0; k < 3; k++) changed = put(sign, at + 1 + k, data.originShift[k]) || changed;
    changed = put(sign, at + 4, data.lightRange) || changed;
    for (let k = 0; k < 16; k++) changed = put(sign, at + 5 + k, data.shiftedToMapUv[k]) || changed;
  }
  lamps.maps.length = lights.length;
  return changed;
}
/** Writes `v` at `at`; true when it differed. */
function put(sign: Float64Array, at: number, v: number) {
  if (sign[at] === v) return false;
  sign[at] = v;
  return true;
}

/**
 * The joint bins of this frame's full-map local lights: kept while their keys hold, dropped when
 * one moves, made anew once the keys held still a frame (`advance`). Keys are made only when the
 * signature changed: a still scene reads 21 numbers a light.
 */
function lampsOf(bound: VsmRowBound, lights: readonly VsmBoundLight[]) {
  const lamps = bound.lamps,
    changed = signed(lamps, lights);
  if (changed) {
    if (lamps.keys.length !== lights.length * KEY)
      lamps.keys = new Float64Array(lights.length * KEY);
    lamps.known = lights.every((light, i) =>
      localKey(light, lamps.keys.subarray(i * KEY, (i + 1) * KEY)),
    );
  }
  if (!lamps.known || !lights.length) return dropJoint(bound, 'none');
  if (sameValues(lamps.keys, lamps.binned)) return;
  if (changed) return dropJoint(bound, 'none');
  lamps.binned = lamps.keys.slice();
  const tables = new Map<string, Pick<Lamp, 'pairs' | 'meets'>>();
  lamps.lamps = lights.map((_, i) => {
    const key = lamps.keys.subarray(i * KEY, (i + 1) * KEY),
      cone = key[AT_CONE] === 1,
      range = key[AT_RANGE] * (1 + ROOM);
    const named = `${range} ${cone}`,
      table = tables.get(named) ?? lampTables(range, cone);
    tables.set(named, table);
    return {
      shape: { axes: key.slice(0, 9), spread: key[AT_SPREAD], roomScale: key[AT_SPREAD], cone },
      ref: splitRef(new Float64Array(6), key.subarray(AT_POSITION, AT_RANGE)),
      ...table,
    };
  });
  startJoint(bound);
}

/** Per bin (j, k), the faces a light of `range` (with its f32 room) meets — none past the range,
 *  a spot's one map, 3 of a point light at a positive depth, else all 6 — and their pages. */
function lampTables(range: number, cone: boolean) {
  const pairs = new Float32Array(S_BINS * E_BINS),
    meets = new Uint8Array(S_BINS * E_BINS);
  for (let j = 0; j < S_BINS; j++)
    for (let k = 0; k < E_BINS; k++) {
      const e = eMost[k];
      if (sLeast[j] > range + 2 * e) continue;
      const at = j * E_BINS + k;
      meets[at] = cone ? 1 : sLeast[j] - 2 * e > 0 ? 3 : 6;
      pairs[at] = meets[at] * mapPages(j, k);
    }
  return { pairs, meets };
}

/** The joint bins left (`state`): none read; their rows freed when they cannot pay. */
function dropJoint(bound: VsmRowBound, state: 'none' | 'hopeless') {
  const lamps = bound.lamps;
  if (lamps.state === state) return;
  if (state === 'none') lamps.binned = new Float64Array(0);
  else lamps.bins = new Uint16Array(0);
  lamps.state = state;
  bound.held = undefined;
}

/** Starts the joint bins from the bound's first row: none binned. */
function startJoint(bound: VsmRowBound) {
  const lamps = bound.lamps;
  lamps.pairs.fill(0);
  lamps.meets.fill(0);
  if (lamps.bins.length < rowsOf(bound)) lamps.bins = new Uint16Array(rowsOf(bound));
  Object.assign(lamps, { state: 'making', cursor: bound.first });
  bound.held = undefined;
}

/** Edges of a row's summed pairs: exact to 127, then sixteenth octaves; and of its summed faces
 *  met (commands: 8 a face, one a mip): exact to 63, then eighth octaves. A row's sum takes the
 *  first edge at or above it; the last edges hold any sum. */
const PAIR_EDGES = Float64Array.from({ length: 512 }, (_, i) =>
  i < 128 ? i : i === 511 ? Number.MAX_SAFE_INTEGER : Math.ceil(128 * 2 ** ((i - 127) / 16)),
);
const MEET_EDGES = Float64Array.from({ length: 128 }, (_, i) =>
  i < 64 ? i : i === 127 ? Number.MAX_SAFE_INTEGER : Math.ceil(64 * 2 ** ((i - 63) / 8)),
);
/** The first of `edges` at or above `v` (an integer sum: itself while the edges are exact). */
function edgeOf(edges: Float64Array, v: number) {
  if (edges[v] === v) return v;
  let lo = 0,
    hi = edges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
// A block's rows' summed pairs and faces met over the lights.
const rowPairs = new Float64Array(BLOCK),
  rowMeets = new Float64Array(BLOCK);

/** Bins rows `[from, to)` of `p` into the joint bins: each light's bin of the row (`binBlock`, the
 *  suns' binning) read as its pairs and faces (`lampTables`), summed, rounded up to an edge. */
function jointRows(lamps: Joint, p: Float32Array, from: number, to: number, first: number) {
  for (let start = from; start < to; start += BLOCK) {
    const n = Math.min(BLOCK, to - start);
    rowPairs.fill(0, 0, n);
    rowMeets.fill(0, 0, n);
    for (const lamp of lamps.lamps) {
      binBlock(lamp.ref, lamp.shape, p, start, n);
      for (let i = 0; i < n; i++) {
        const bin = binOf(i);
        rowPairs[i] += lamp.pairs[bin];
        rowMeets[i] += lamp.meets[bin];
      }
    }
    for (let i = 0, at = start - first; i < n; i++, at++) {
      const pair = edgeOf(PAIR_EDGES, rowPairs[i]),
        meet = edgeOf(MEET_EDGES, rowMeets[i]);
      lamps.bins[at] = pair | (meet << 9);
      lamps.pairs[pair]++;
      lamps.meets[meet]++;
    }
  }
}
function unbinJoint(lamps: Joint, from: number, to: number, first: number) {
  for (let row = from; row < to; row++) {
    const bin = lamps.bins[row - first];
    lamps.pairs[bin & 511]--;
    lamps.meets[bin >> 9]--;
  }
}
/** Bins the joint bins on to row `to`. */
function catchUpJoint(lamps: Joint, bound: VsmRowBound, to: number) {
  jointRows(lamps, bound.spheres!.packed, lamps.cursor, to, bound.first);
  lamps.cursor = to;
}
/** The weight of the k heaviest rows of `counts`, a row of bin i weighing `edges[i] · scale`, at
 *  most `most`, which grows with i: read from the top bin down, no sort. Made once a bound. */
class Ascending implements Top {
  most = Infinity;
  private readonly counts: Uint32Array;
  private readonly edges: Float64Array;
  private readonly scale: number;
  constructor(counts: Uint32Array, edges: Float64Array, scale: number) {
    this.counts = counts;
    this.edges = edges;
    this.scale = scale;
  }
  top(k: number) {
    const { counts, edges, scale, most } = this;
    let sum = 0;
    for (let i = counts.length - 1; i >= 0 && k > 0; i--) {
      const n = Math.min(counts[i], k);
      sum += n * Math.min(edges[i] * scale, most);
      k -= n;
    }
    return sum;
  }
}
/** The joint bins' pairs (each row at most `pages`) and commands a row. */
function jointWeights(lamps: Joint, pages: number) {
  lamps.tops[0].most = pages;
  return lamps.tops;
}

/** True when the rows the joint bins hold already make, in the worst case's chunk plus one row,
 *  more pairs or commands than `cap`: more rows only add, so the bins cannot beat that chunk. */
function beyond(lamps: Joint, worst: VsmWorst) {
  const k = worst.rows + 1,
    [pairs, cmds] = jointWeights(lamps, worst.pages);
  return (
    Math.min(pairs.top(k), k * worst.pages) > worst.cap ||
    Math.min(cmds.top(k), k * worst.cmdsPerRow) > worst.cap
  );
}

/** What `measure` reads beside the bins: the frame's numbers (`Scratch.numbers`, first) and each
 *  level's reach and pages (`Scratch.levels`), written into the bound's scratch arrays: the key
 *  is `Scratch.key`, the held answer's in `held.key` until the two swap (`vsmBoundChunk`). */
function measureKey(bound: VsmRowBound) {
  const sc = bound.scratch;
  let size = sc.numbers.length;
  for (let s = 0; s < bound.suns.length; s++) {
    const sun = bound.suns[s],
      want = sun.clipmap.levels.length * 4;
    if ((sc.levels[s]?.length ?? -1) !== want) sc.levels[s] = new Float64Array(want);
    const out = sc.levels[s],
      { axes } = sun.shape,
      { ref } = nowOf(sun);
    for (let i = 0; i < sun.clipmap.levels.length; i++) {
      const level = sun.clipmap.levels[i];
      const hx = 1 / Math.abs(level.viewToClip[0]),
        hy = 1 / Math.abs(level.viewToClip[5]);
      const c = level.worldCentre;
      const dx = c[0] - ref[0] - ref[3],
        dy = c[1] - ref[1] - ref[4],
        dz = c[2] - ref[2] - ref[5];
      const off = Math.max(Math.abs(dot(axes, 0, dx, dy, dz)), Math.abs(dot(axes, 3, dx, dy, dz)));
      // Reach of the level's box from the reference; the f32 room of the centre's distance to it.
      out[i * 4] = Math.max(hx, hy) + off;
      out[i * 4 + 1] = ROOM * (Math.hypot(dx, dy, dz) + Math.max(hx, hy) + off);
      out[i * 4 + 2] = (2 * hx) / SIDE;
      out[i * 4 + 3] = (2 * hy) / SIDE;
    }
    size += want;
  }
  sc.levels.length = bound.suns.length;
  if (sc.key.length !== size) sc.key = new Float64Array(size);
  sc.key.set(sc.numbers);
  let at = sc.numbers.length;
  for (const l of sc.levels) {
    sc.key.set(l, at);
    at += l.length;
  }
  return sc.key;
}

/** The weight of the k heaviest rows. */
interface Top {
  top(k: number): number;
}
/** Bins a sun holds at most: an integer weight times this, plus the bin, orders them by weight. */
const BIN_SPAN = S_BINS * E_BINS;
/** The rows of a sun's bins by weight, heaviest first, as prefix sums over that order. Its arrays
 *  are kept and refilled (`fill`): `n` bins read, the arrays hold at least that many (+1). The
 *  weights are counts (pages, commands), whole numbers: each bin's key `weight · BIN_SPAN + bin`
 *  sorts as a number, with no comparator; bins of one weight take any order among themselves, which
 *  changes no top — their rows weigh the same, and every sum is of whole numbers, exact. */
class Heaviest implements Top {
  private n = 0;
  private rows = new Float64Array(1);
  private sums = new Float64Array(1);
  private weight = new Float64Array(0);
  private order = new Float64Array(0);
  fill(weight: Float64Array, rows: Uint32Array, n: number) {
    if (this.weight.length < n) {
      this.rows = new Float64Array(n + 1);
      this.sums = new Float64Array(n + 1);
      this.weight = new Float64Array(n);
      this.order = new Float64Array(n);
    }
    this.n = n;
    const order = this.order.subarray(0, n);
    for (let i = 0; i < n; i++) order[i] = weight[i] * BIN_SPAN + i;
    order.sort();
    this.rows[0] = this.sums[0] = 0;
    for (let i = 0; i < n; i++) {
      const t = order[n - 1 - i] % BIN_SPAN;
      this.weight[i] = weight[t];
      this.rows[i + 1] = this.rows[i] + rows[t];
      this.sums[i + 1] = this.sums[i] + rows[t] * weight[t];
    }
    return this;
  }
  /** The weight of the k heaviest rows. */
  top(k: number) {
    const { rows, sums, weight, n } = this;
    if (k >= rows[n]) return sums[n];
    let lo = 0,
      hi = n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rows[mid] <= k) lo = mid;
      else hi = mid - 1;
    }
    return sums[lo] + (k - rows[lo]) * weight[lo];
  }
}

/** What `measure` keeps between frames: the key's words and its scratch copy, each sun's levels,
 *  their order by reach and their pages' prefix sums (`sunWeights`), the weights of the suns' bins
 *  (two a sun: pairs, commands), the chunk it answers with and the numbers that chunk reads. The
 *  chunk is valid until the bound's next answer. */
interface Scratch {
  numbers: Float64Array;
  key: Float64Array;
  levels: Float64Array[];
  levelOrder: Uint32Array;
  spans: Float64Array;
  weights: Heaviest[];
  tops: Top[];
  chunk: VsmChunk;
  perPairs: number;
  perCmds: number;
  mostPairs: number;
  mostCmds: number;
}
function scratchOf(): Scratch {
  const sc: Scratch = {
    numbers: new Float64Array(7),
    key: new Float64Array(0),
    levels: [],
    levelOrder: new Uint32Array(0),
    spans: new Float64Array(0),
    weights: [],
    tops: [],
    perPairs: 0,
    perCmds: 0,
    mostPairs: 0,
    mostCmds: 0,
    chunk: {
      rows: 0,
      pairs: (k) => weigh(sc, 0, k * sc.perPairs, k * sc.mostPairs, k),
      cmds: (k) => weigh(sc, 1, k * sc.perCmds, k * sc.mostCmds, k),
    },
  };
  return sc;
}
/** The weight of `k` rows, `f` 0 pairs, 1 commands: the bounds' sum, at most `most`. */
function weigh(sc: Scratch, f: 0 | 1, sum: number, most: number, k: number) {
  for (let i = f; i < sc.tops.length; i += 2) sum += sc.tops[i].top(k);
  return Math.min(sum, most);
}

// Each non-empty bin's pairs and commands a row and its rows (`sunWeights`): `Heaviest` reads them.
const binPairs = new Float64Array(S_BINS * E_BINS),
  binCmds = new Float64Array(S_BINS * E_BINS),
  binHeld = new Uint32Array(S_BINS * E_BINS);

/** Pages a row of e-bin k spans a side of a page of `page` metres: ceil(2e / page + 2 pixels) + 1
 *  pages, at most a level's or a mip's `side`. */
const sideOf = (e: number, page: number, side = SIDE) =>
  Math.min(side, Math.ceil((2 * e) / page + 1 / 64) + 1);

/** Level i's reach with its room: an s past it meets the level no more. */
const reachOf = (levels: Float64Array, i: number) => levels[i * 4] + levels[i * 4 + 1];

/** A sun's non-empty bins as their pairs and commands a row, each read at its least s and its
 *  greatest e, over `levels` (`measureKey`). The levels a bin meets are those its least s does not
 *  pass: in the order of their reach, farthest first (a reach NaN no s passes), a prefix, which
 *  shortens as s grows. A bin's pages are then that prefix's sum of the pages its e spans, one
 *  per (e-bin, level) summed once — whole numbers, the same in any order. */
function sunWeights(sc: Scratch, s: number, sun: SunRows, pages: number) {
  const levels = sc.levels[s],
    count = levels.length / 4,
    stride = count + 1;
  if (sc.levelOrder.length < count) sc.levelOrder = new Uint32Array(count);
  const order = sc.levelOrder.subarray(0, count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => {
    const ra = reachOf(levels, a),
      rb = reachOf(levels, b);
    return Number.isNaN(ra) ? -1 : Number.isNaN(rb) ? 1 : rb - ra;
  });
  // Pages a row of e-bin k spans over the first m levels of that order.
  if (sc.spans.length < E_BINS * stride) sc.spans = new Float64Array(E_BINS * stride);
  const spans = sc.spans;
  for (let k = 0; k < E_BINS; k++) {
    spans[k * stride] = 0;
    for (let m = 0; m < count; m++) {
      const i = order[m],
        e = eMost[k] + levels[i * 4 + 1];
      spans[k * stride + m + 1] =
        spans[k * stride + m] + sideOf(e, levels[i * 4 + 2]) * sideOf(e, levels[i * 4 + 3]);
    }
  }
  const counts = nowOf(sun).counts;
  let n = 0,
    met = count;
  for (let j = 0; j < S_BINS; j++) {
    while (met > 0 && sLeast[j] > reachOf(levels, order[met - 1])) met--;
    for (let k = 0; k < E_BINS; k++) {
      const held = counts[j * E_BINS + k];
      if (held === 0) continue;
      binPairs[n] = Math.min(spans[k * stride + met], pages);
      binCmds[n] = met;
      binHeld[n++] = held;
    }
  }
  sc.weights[2 * s] ??= new Heaviest();
  sc.weights[2 * s + 1] ??= new Heaviest();
  sc.tops.push(
    sc.weights[2 * s].fill(binPairs, binHeld, n),
    sc.weights[2 * s + 1].fill(binCmds, binHeld, n),
  );
}

/** Pages a row of bin (j, k) takes over a local map's mips, its rect ≤ 4e / (s − 2e) NDC an axis
 *  (a mip of N pages: N/2 a unit), every page of the map when its depth is not positive — the
 *  same for every light: made once a bin. */
const mapPagesOf = new Float64Array(S_BINS * E_BINS).fill(NaN);
function mapPages(j: number, k: number) {
  const at = j * E_BINS + k;
  if (!Number.isNaN(mapPagesOf[at])) return mapPagesOf[at];
  const e = eMost[k],
    depth = sLeast[j] - 2 * e,
    span = depth > 0 ? Math.min(2, (4 * e) / depth) : 2;
  let total = 0;
  for (let mip = 0; mip < VSM_MIPS; mip++) {
    const n = SIDE >> mip;
    total += sideOf(span / 4, 1 / n, n) ** 2;
  }
  return (mapPagesOf[at] = total);
}

/** The most rows ≥ `worst.rows` whose bound holds within `cap`, over the bins of `bound`: the
 *  bound's scratch chunk, its `levels` those `measureKey` wrote. */
function measure(
  bound: VsmRowBound,
  worst: VsmWorst,
  candidates: number,
  local: Pick<FrameLights, 'pairs' | 'cmds' | 'lamps'>,
): VsmChunk {
  const sc = bound.scratch;
  sc.tops.length = 0;
  for (let s = 0; s < bound.suns.length; s++) sunWeights(sc, s, bound.suns[s], worst.pages);
  if (local.lamps) {
    const [pairs, cmds] = jointWeights(bound.lamps, worst.pages);
    sc.tops.push(pairs, cmds);
  }
  sc.perPairs = local.pairs;
  sc.perCmds = local.cmds;
  sc.mostPairs = worst.pages;
  sc.mostCmds = worst.cmdsPerRow;
  const { chunk } = sc;
  let lo = worst.rows,
    hi = Math.max(lo, candidates);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chunk.pairs(mid) <= worst.cap && chunk.cmds(mid) <= worst.cap) lo = mid;
    else hi = mid - 1;
  }
  chunk.rows = lo;
  return chunk;
}

/** The worst case of a pass: rows a chunk, commands a row, pages, and the most pairs and commands
 *  a chunk's lists hold (`cap` ≥ rows · pages ≥ rows · commands). */
export interface VsmWorst {
  rows: number;
  cmdsPerRow: number;
  pages: number;
  cap: number;
}

/** This frame's lights as the bound reads them: the suns' clipmaps, the full-map local lights,
 *  and the pairs and commands a row makes beside the bins (the single-page maps', then the
 *  full maps' until their bins are whole: `lamps`); undefined when a directional light comes
 *  without its clipmap. */
interface FrameLights {
  clipmaps: VsmClipmap[];
  maps: VsmBoundLight[];
  pairs: number;
  cmds: number;
  lamps: boolean;
}
function frameLights(lights: readonly VsmBoundLight[]): FrameLights | undefined {
  const frame: FrameLights = { clipmaps: [], maps: [], pairs: 0, cmds: 0, lamps: false };
  for (const light of lights) {
    if (!light.shouldRender) continue;
    if (light.kind === 'directional') {
      if (!light.clipmap) return undefined;
      frame.clipmaps.push(light.clipmap);
    } else if (light.singlePage) {
      frame.pairs += light.count;
      frame.cmds += light.count * VSM_MIPS;
    } else frame.maps.push(light);
  }
  return frame;
}

/** Brings the bins to this frame's suns, rows and lights, and makes one slice more of those being
 *  made: undefined while a sun turns, else whether they were binned anew or replaced. */
function updateBins(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number; candidates: number },
  frame: FrameLights,
  worst: VsmWorst,
) {
  const turned = sunsOf(bound, frame.clipmaps);
  if (turned === undefined) return undefined;
  const followed = follow(bound, spheres, range.first, range.end, !turned);
  const fresh = turned || !followed;
  if (fresh) bin(bound, spheres, range, followed);
  lampsOf(bound, frame.maps);
  // More rows than the worst case's chunk: the lights' bins may pay — until rows written make them
  // unable to beat it.
  const pays = range.candidates > worst.rows;
  const swapped = advance(bound, pays) && !fresh;
  const state = bound.lamps.state;
  if (pays && (state === 'making' || state === 'whole') && beyond(bound.lamps, worst))
    dropJoint(bound, 'hopeless');
  return fresh || swapped;
}

/** The chunk the bins give `frame`: the held one when nothing `measure` reads moved, else measured
 *  and held. `rebinned`: the bins were just made, their chunks the reference a camera's travel
 *  is weighed against. */
function answer(
  bound: VsmRowBound,
  worst: VsmWorst,
  candidates: number,
  frame: FrameLights,
  rebinned: boolean,
) {
  const sc = bound.scratch,
    n = sc.numbers;
  n[0] = worst.rows;
  n[1] = worst.cmdsPerRow;
  n[2] = worst.pages;
  n[3] = worst.cap;
  n[4] = candidates;
  n[5] = frame.pairs;
  n[6] = frame.cmds;
  const key = measureKey(bound);
  const held = bound.held;
  if (held && sameValues(held.key, key)) return held.chunk;
  const chunk = measure(bound, worst, candidates, frame);
  const chunks = ceilDiv(candidates, chunk.rows);
  if (rebinned) bound.binnedChunks = chunks;
  // The camera's travel costs a chunk: bins around it, a slice a frame (`advance`).
  else if (chunks > bound.binnedChunks) startMaking(bound);
  // The key just measured is the held one's from now; the old one is the next frame's scratch.
  if (held) {
    sc.key = held.key;
    held.key = key;
    held.chunk = chunk;
  } else {
    bound.held = { chunk, key };
    sc.key = new Float64Array(key.length);
  }
  return chunk;
}

/**
 * The chunk of rows `[first, end)` of `spheres`, `candidates` of them drawn, under this frame's
 * `lights`: at least `worst.rows` rows. Undefined when no sun's clipmap nor local light's bins
 * bound them, while a sun turns, or when a directional light comes without its clipmap: the caller
 * keeps the worst case.
 */
export function vsmBoundChunk(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number; candidates: number },
  lights: readonly VsmBoundLight[],
  worst: VsmWorst,
): VsmChunk | undefined {
  const frame = frameLights(lights);
  // Rows past the copy have no sphere to bound them.
  if (!frame || !(frame.clipmaps.length || frame.maps.length)) return undefined;
  if (range.end <= range.first || range.end > spheres.packed.length / STRIDE) return undefined;
  const rebinned = updateBins(bound, spheres, range, frame, worst);
  if (rebinned === undefined || bound.suns.some((sun) => !sun.ready)) return undefined;
  // The local lights are bounded by their bins once whole; until then, every page a row.
  frame.lamps = bound.lamps.state === 'whole';
  if (!frame.lamps)
    for (const light of frame.maps) {
      frame.pairs += worst.pages;
      frame.cmds += light.count * VSM_MIPS;
    }
  if (!frame.clipmaps.length && !frame.lamps) return undefined;
  return answer(bound, worst, range.candidates, frame, rebinned);
}
