// What the shading reads, restated from `shadowFactorWgsl.ts` over the kernel's own records — the
// lamp's face matrices, the sun's frame and windows —: the pages its pixels ask for, the list its
// readback carries (#1209). `READ` holds the WGSL lines restated here; the tests pin them. With it,
// floor tiles: the clusters a frame draws and the points their pixels light.
import { LIGHT_KIND, type ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { transformHomogeneousPoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import {
  LAMP_SIDE,
  SHADOW_PAGE,
  SUN_LEVELS,
  SUN_WINDOW,
  lampFacesOf,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  PAGES,
  lampEntry,
  sunEntry,
} from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { BIAS, along, sub, type Vec } from '../../lighting/direct/shadowBias.fixture.ts';
import { pointFaceOf } from '../../lighting/direct/shadowLamp.fixture.ts';
import { pcfPages } from '../../../../sdk-core/src/scene/light-shadow/pageModel.fixture.ts';

/** The lines of `shadowFactorWgsl.ts` and `shadowWgsl.ts` this fixture restates. */
export const READ = [
  ' let texel0=shadowLampFinestTexel(info.y,radius);',
  ' let wanted=shadowLampReadMip(shadowFootprint,texel0);',
  ' let t=vec2f(shadowLampMapTexel(ndc.x,side),shadowLampMapTexel(-ndc.y,side));',
  ' let home=clamp(vec2i(shadowPageOfTexel(t.x),shadowPageOfTexel(t.y)),vec2i(0),vec2i(i32(pages)-1));',
  ' for(var level=shadowSunReadLevel(shadowFootprint,finest);level<last;level++){',
  ' let t=vec2f(shadowSunMapTexel(dot(Q,right),origin.x,level),shadowSunMapTexel(-dot(Q,up),origin.y,level));',
  ' return ShadowAt(map,t,vec2i(shadowPageOfTexel(t.x),shadowPageOfTexel(t.y)),Q,texel);',
  ' let edge=vec2i(shadowPcfEdge(t.x,first.x),shadowPcfEdge(t.y,first.y))>vec2i(0);',
  '  if(any(p<vec2i(0))||any(p>=vec2i(m.pages))){return -1;}',
];

/** A lit point: where it lies, its normal. */
export type Lit = { P: Vec; N: Vec };
/** Hears each page a read takes and the texel of it the shader checks (`shadowPageWord`). */
export type TexelSink = (entry: number, local: number[]) => void;
/** Texel `t` of a map, relative to page `p`, clamped to it: what `shadowFootprintCovers` reads. */
const localOf = (t: number[], p: number[]) =>
  t.map((c, a) => Math.min(Math.max(c - p[a] * SHADOW_PAGE, 0), SHADOW_PAGE));
const UP: Vec = [0, 1, 0];

const matrices = new Float32Array(6 * 16),
  clip = new Float64Array(4);
const dot = (a: Vec, b: ArrayLike<number>, at = 0) =>
  a[0] * b[at] + a[1] * b[at + 1] + a[2] * b[at + 2];

/** The pages the lamp in `slot` has its pixel at `lit` read, at the mip it wants. */
function lampReads(
  plan: ShadowPlan,
  store: SceneLightStore,
  slot: number,
  lit: Lit,
  f: number,
  sink?: TexelSink,
) {
  const light = store.light(store.ids[slot])!,
    faces = lampFacesOf(LIGHT_KIND[light.kind]),
    base = plan.table.baseOf(store.sliceOf(slot));
  let tanHalf = 0;
  for (let face = 0; face < faces; face++)
    tanHalf = Math.tan(writeFace(matrices, face * 16, null, 0, light, face).halfFov);
  const L = light.position!,
    toLight = sub(L, lit.P),
    radius = Math.hypot(...toLight);
  if (radius > light.range!) return [];
  const texel0 = PAGES.shadowLampFinestTexel(tanHalf, radius);
  const mip = PAGES.shadowLampReadMip(f, texel0);
  const cosine = Math.min(Math.max(dot(lit.N, toLight) / radius, 1e-3), 1);
  const Q = along(lit.P, lit.N, BIAS(texel0 * 2 ** mip, cosine)[0]);
  const face = faces > 1 ? pointFaceOf(sub(Q, L)) : 0;
  transformHomogeneousPoint(clip, matrices.subarray(face * 16), Q[0], Q[1], Q[2]);
  if (clip[3] <= 0) return [];
  const [u, v] = [clip[0] / clip[3], clip[1] / clip[3]];
  if (faces === 1 && (Math.abs(u) > 1 || Math.abs(v) > 1)) return [];
  const pages = LAMP_SIDE >> mip,
    t = [u, -v].map((ndc) => PAGES.shadowLampMapTexel(ndc, pages * SHADOW_PAGE));
  const clamp = (p: number) => Math.min(pages - 1, Math.max(0, p));
  return pcfPages(
    t,
    t.map((c) => clamp(PAGES.shadowPageOfTexel(c))),
  ).map(([x, y]) => {
    const entry = base + lampEntry(face, mip, clamp(x), clamp(y));
    sink?.(entry, localOf(t, [clamp(x), clamp(y)]));
    return entry;
  });
}

/** The pages the sun in `slice` has its pixel at `lit` read: its first level in the window. */
function sunReads(plan: ShadowPlan, slice: number, lit: Lit, f: number, sink?: TexelSink) {
  const { sun } = plan,
    base = plan.table.baseOf(slice),
    finest = sun.finest[slice];
  const cosine = Math.min(Math.max(-dot(lit.N, sun.frame, slice * 9 + 6), 1e-3), 1);
  for (let level = PAGES.shadowSunReadLevel(f, finest); level < finest + SUN_LEVELS; level++) {
    const texel = PAGES.shadowSunTexelMetres(level),
      origin = [0, 1].map((axis) => sun.originOf(slice, level, axis));
    const Q = along(lit.P, lit.N, BIAS(texel, cosine)[0]);
    const t = [
      PAGES.shadowSunMapTexel(dot(Q, sun.frame, slice * 9), origin[0], level),
      PAGES.shadowSunMapTexel(-dot(Q, sun.frame, slice * 9 + 3), origin[1], level),
    ];
    const home = t.map(PAGES.shadowPageOfTexel),
      inside = (p: number[]) => p.every((c) => c >= 0 && c < SUN_WINDOW);
    if (!inside(home)) continue;
    return pcfPages(t, home)
      .filter(inside)
      .map(([x, y]) => {
        const entry = base + sunEntry(level, x + origin[0], y + origin[1]);
        sink?.(entry, localOf(t, [x, y]));
        return entry;
      });
  }
  return [];
}

/** Every page the frame's shading reads at the points `lits`, each named once: what its readback
 *  lists, seen from `view`. */
export function shadingReads(
  plan: ShadowPlan,
  store: SceneLightStore,
  view: ShadowViewpoint,
  lits: Lit[],
  sink?: TexelSink,
) {
  const read = new Set<number>();
  for (const lit of lits) {
    const f = (view.pixelNear * dot(sub(lit.P, view.position), view.forward)) / view.near;
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0) continue;
      const pages =
        store.light(store.ids[slot])!.kind === 'directional'
          ? sunReads(plan, slice, lit, f, sink)
          : lampReads(plan, store, slot, lit, f, sink);
      for (const entry of pages) read.add(entry);
    }
  }
  return [...read].sort((a, b) => a - b);
}

/** Floor tiles of one metre, `[x, z]` their least corner each: their boxes, flat on `y = 0`, and
 *  the lit points a grid of `n × n` pixels on each reads — the corners and edges included. */
export function floorTiles(tiles: number[][], n = 5) {
  const boxes: number[][] = [],
    lits: Lit[] = [];
  tiles.forEach(([x, z]) => {
    boxes.push([x, 0, z, x + 1, 0, z + 1]);
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) lits.push({ P: [x + a / (n - 1), 0, z + b / (n - 1)], N: UP });
  });
  return { boxes, lits };
}

/** The tiles of `[x0, x1) × [z0, z1)`. */
export const tileGrid = (x0: number, x1: number, z0: number, z1: number) =>
  Array.from({ length: (x1 - x0) * (z1 - z0) }, (_, i) => [
    x0 + (i % (x1 - x0)),
    z0 + Math.floor(i / (x1 - x0)),
  ]);
