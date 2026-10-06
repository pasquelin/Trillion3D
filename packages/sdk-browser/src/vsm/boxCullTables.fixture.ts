// What the tests of the shared box cull (`boxCull*.test.ts`) run a text over: stand-in page
// tables — page offsets, page marks and receiver covers hashed from their address, allocated rects
// (a few pages, or a whole level), the coarse-page thresholds and a log of what the text hands
// them —, one set a case, read through one scope so that a text compiles once a test; and the
// boxes' lights.
import { Mat, shaderRun } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import { VSM_CONSTANTS_WGSL } from './constants.ts';
import { vsmInvalidationWgsl } from './invalidationWgsl.ts';
import { vsmRenderCullWgsl } from './renderCullWgsl.ts';
import { vsmLayout } from './resources.ts';
import { MORE_BUILTINS, hashWord, inputs, withArrays } from './sameBits.fixture.ts';

export type Draw = ReturnType<typeof inputs>;
const LAYOUT = vsmLayout({ fullMapCapacity: 63 }, 1 << 27);
/** The two shipped modules the shared box cull is compiled into, on the one layout. */
export const INVALIDATION = vsmInvalidationWgsl(LAYOUT),
  RENDER = vsmRenderCullWgsl(LAYOUT);
type Fn = (...args: unknown[]) => unknown;
type Offset = { tableXY: number[] };

/** Case `seed`'s tables, drawn from `d`: page marks sparse by a drawn mask, thresholds in the
 *  pixel radii a box gets (now and then an edge). */
export function tables(seed: number, d: Draw) {
  const mask = d.pick([1, 3, 9, 15, 0xffffffff]);
  const word = (...w: number[]) => hashWord(seed, ...w) & hashWord(seed + 1, ...w) & mask;
  const offset = (id: number, level: number, page: number[]) => ({
    tableXY: [(page[0] + 3 * level + id) >>> 0, (page[1] + 5 * level) >>> 0],
  });
  const writes: unknown[][] = [];
  const bound = (_: unknown, i: number) => {
    const x = d.int(0, 120),
      y = d.int(0, 120),
      last = (128 >> (i % 8)) - 1;
    return d.bool() ? [0, 0, last, last] : [x, y, x + d.int(-1, 6), y + d.int(-1, 6)];
  };
  const radius = () => (d.int(0, 7) ? Math.fround(2 ** (d.random() * 16 - 2)) : d.f());
  const thresholds = ['Static', 'Dynamic', 'DynamicCluster'].map((k) => [k, radius()]);
  return {
    writes,
    vsm: Object.fromEntries(thresholds.map(([k, v]) => [`coarsePagePixelThreshold${k}`, v])),
    bounds: Array.from({ length: d.int(0, 3) * 8 }, bound),
    vsmTableEntryOf: (h: { id: number }, level: number, page: number[]) =>
      offset(h.id, level, page),
    vsmTableLevelOrigin: (h: { id: number }, level: number) => ({ id: h.id, level }),
    vsmTableEntryAt: (o: { id: number }, level: number, page: number[]) =>
      offset(o.id, level, page),
    vsmPageMarkWord: (o: Offset) => word(...o.tableXY, 9),
    vsmGatherPageMarks: (t: number[], m: number) => [0, 1, 2, 3].map((i) => word(...t, m, i)),
    vsmGatherCover: (t: number[], m: number) =>
      [0, 1, 2, 3].map((i) => hashWord(seed, 7, ...t, m, i) & 0xffff),
    vsmHandleIsValid: (h: { id: number }) => h.id !== 0xffffffff,
    vsmMarkStale: (o: Offset, flags: number) => void writes.push([...o.tableXY, flags]),
  };
}
type Tables = ReturnType<typeof tables>;

const STAND_INS = [
  ...['vsmTableEntryOf', 'vsmTableLevelOrigin', 'vsmTableEntryAt'],
  ...['vsmPageMarkWord', 'vsmGatherPageMarks', 'vsmGatherCover', 'vsmHandleIsValid'],
  'vsmMarkStale',
] as const;
const vsm: Record<string, unknown> = {},
  vsmMappedRects: number[][] = [];
let current: Tables;
const SCOPE = {
  ...wgslConstants(VSM_CONSTANTS_WGSL),
  ...MORE_BUILTINS,
  vsm,
  vsmMappedRects,
  ...Object.fromEntries(
    STAND_INS.map((name) => [name, (...args: unknown[]) => (current[name] as Fn)(...args)]),
  ),
};
/** Logs `entry` in the tables the texts read. */
export const record = (...entry: unknown[]) => void current.writes.push(entry);
/** Makes `t` the tables the texts read, and returns it. */
export function use(t: Tables) {
  current = t;
  Object.assign(vsm, t.vsm);
  vsmMappedRects.splice(0, vsmMappedRects.length, ...t.bounds);
  return t;
}
/** The functions `names` of a WGSL text, over the tables `use` sets (and `more`). */
export const run = (source: string, names: string[], more: object = {}) =>
  shaderRun<Record<string, Fn>>(withArrays(source), names, {
    ...SCOPE,
    ...wgslConstants(source),
    ...more,
  });

/** A map's handle: a full map's or, one in eight, a single page's. */
export const handle = (d: Draw) => ({ id: d.int(0, 40), isSinglePage: d.int(0, 7) === 0 });
/** A rect within `size` (pages or pixels), some empty or reversed, one in sixteen the
 *  invalidation's empty bounds. */
export function pageRect(d: Draw, size: number) {
  if (d.int(0, 15) === 0) return [0xffffffff, 0xffffffff, d.int(0, 9), d.int(0, 9)];
  const x = d.int(0, size),
    y = d.int(0, size);
  return [x, y, x + d.int(-2, size >> 1), y + d.int(-2, size >> 1)];
}

/** A light's view: a sun's orthographic one, or a local light's perspective one (w = view z),
 *  turned at random, and the UV matrix of its clip space; every value drawn one case in three. */
export function lightView(d: Draw, k: number) {
  if (k % 3 === 0) return { uv: d.mat(), viewToClip: d.mat(), directional: d.bool() };
  const directional = d.bool(),
    [a, b, c] = d.vec(3, () => d.random() * 2 * Math.PI);
  const [ca, sa, cb, sb, cc, sc] = [a, a, b, b, c, c].map((x, i) =>
    (i % 2 ? Math.sin : Math.cos)(x),
  );
  const x = [ca * cb, sa * cb, -sb],
    y = [ca * sb * sc - sa * cc, sa * sb * sc + ca * cc, cb * sc];
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const at = d.vec(3, () => (d.random() - 0.5) * 8);
  const view = new Mat([...x, 0, ...y, 0, ...z, 0, ...at, 1]);
  const s = directional ? 1 / d.int(4, 64) : 1 / Math.tan(d.random() + 0.3);
  const p = directional ? [-1 / 100, 0, 0.5, 1] : [0, 1, 0.05, 0];
  const viewToClip = new Mat([s, 0, 0, 0, 0, s, 0, 0, 0, 0, p[0], p[1], 0, 0, p[2], p[3]]);
  const toUv = new Mat([0.5, 0, 0, 0, 0, -0.5, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1]);
  const uv = MORE_BUILTINS.$b('*', MORE_BUILTINS.$b('*', toUv, viewToClip), view) as Mat;
  return {
    uv: new Mat(uv.m.map(Math.fround)),
    viewToClip: new Mat(viewToClip.m.map(Math.fround)),
    directional,
  };
}
