// #991: the sun's page read, run from its shipped WGSL through `shaderFunctions`, beside develop's
// before #991 (654d1311f), which read every page at one reference. The record the shader reads is
// the one `createShadowRecordPack` writes. The harness has no vector arithmetic: the world lies on
// one line — every vector its x, `dot` a product — and `vec2f` answers one axis, `lane`, of two.
import { SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_RECORD_FRAME,
  SHADOW_RECORD_INFO,
  SHADOW_RECORD_ORIGINS,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { SunLevels } from '../../../../sdk-core/src/scene/light-shadow/sunLevels.ts';
import {
  PAGE_RANGE_SHIFT,
  PAGE_VALID,
  SUN_DEPTH_RANGES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createShadowRecordPack } from '../../gpu/shadow/recordPack.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { hash } from './shadowPages.fixture.ts';
import { directShadowWgsl } from './shadowWgsl.ts';

/** The shipped shadow read: `shadowPcf`, its helpers, and `SHADOW_FACTOR_WGSL` after them. */
export const SHADOW_WGSL = directShadowWgsl(0, null, 1);

/** Develop's `sunShadowFactor` before #991, its code verbatim: one reference,
 *  whatever range a page holds. */
export const DEVELOP_SUN_SHADOW_FACTOR = `fn sunShadowFactor(index:u32,P:vec3f,N:vec3f,taps:bool)->f32{
 let f0=shadows.records[index].frame[0];let f1=shadows.records[index].frame[1];
 let right=f0.xyz;let up=f1.xyz;let axis=shadows.records[index].frame[2].xyz;
 let zNear=f0.w;let invDepth=1.0/max(f1.w-zNear,1e-6);
 let info=shadows.records[index].info;
 let finest=i32(info.y);let last=finest+i32(info.x);
 let cosine=clamp(dot(N,-axis),1e-3,1.0);
 let slope=sqrt(1.0-cosine*cosine)/cosine;
 let offset=shadowNormalTexels(cosine);
 for(var level=max(i32(floor(log2(max(shadowFootprint,1e-30)))),finest);level<last;level++){
  let texel=exp2(f32(level));
  let page=texel*SHADOW_PAGE;
  let slot=shadowRing(level,SUN_LEVEL_COUNT);
  let origin=sunOrigin(index,slot);
  let Q=P+N*(texel*offset);
  let t=vec2f(dot(Q,right)-f32(origin.x)*page,-dot(Q,up)-f32(origin.y)*page)/texel;
  let map=ShadowMap(u32(info.w)+u32(slot)*SUN_LEVEL_WORDS,1u,SUN_WINDOW_PAGES,origin.x,origin.y);
  let home=vec2i(floor(t/SHADOW_PAGE));
  let word=shadowPageWord(map,home);
  if(word==0u){continue;}
  let reference=1.0-(dot(Q,axis)-zNear-shadowDepthMargin(texel,slope,1.0))*invDepth+SHADOW_DEPTH_ROUNDING;
  return shadowPcf(map,t,reference,home,word,0.0,taps);
 }
 return sunFarShadowFactor(P,N,-axis);
}`;

/** Develop's `shadowNeighbour` before #991, verbatim: any readable neighbour is read. */
export const DEVELOP_SHADOW_NEIGHBOUR = `fn shadowNeighbour(m:ShadowMap,p:vec2i,home:vec3f)->vec4f{
 let word=shadowPageWord(m,p);
 if(word==0u){return vec4f(home,0.0);}
 return vec4f(shadowOffset(word,p),1.0);
}`;

/** Every scalar `const` of a WGSL text, by name: what the shader compiles, not a copy of it. */
export function wgslConstants(source: string) {
  const constants: Record<string, number> = {};
  for (const [, name, value] of source.matchAll(/const (\w+):(?:f32|u32|i32)=([^;]+);/g))
    if (Number.isFinite(Number(value.replace(/u$/, ''))))
      constants[name] = Number(value.replace(/u$/, ''));
  return constants;
}

/** An array read as WGSL indexes one: `i/8u` truncated, as its integer division is. */
const truncating = <T>(at: (i: number) => T) =>
  new Proxy([], { get: (_, key) => at(Math.trunc(Number(key))) }) as unknown as T[];

/** Slot `drawn`'s pair, or an origin pair, as the shader's `vec4`: `.xy` and `.zw`. */
const pairs = (read: (i: number) => number, at: number) => ({
  xy: { x: read(at), y: read(at + 1) },
  zw: { x: read(at + 2), y: read(at + 3) },
});

export type Sun = {
  /** `zNear, zFar` of each slot, `SUN_DEPTH_RANGES` of them. */
  ranges: Array<[number, number]>;
  current: number;
  levels: number;
  finest: number;
  tableBase: number;
};

/** The sun's record as `writeSun` packs it, read field by field as the WGSL struct lays it out:
 *  six matrices of four columns, three frame rows, the origins' vec4i, the header. On the line,
 *  `right` is +x, `up` −x and the light's `axis` −x: a receiver's depth is −P. */
export function sunRecord(sun: Sun) {
  const pack = createShadowRecordPack(256, 8),
    depth = new Float32Array(SUN_DEPTH_RANGES * 2);
  sun.ranges.forEach(([near, far], slot) => depth.set([near, far], slot * 2));
  const origins = Array.from({ length: sun.levels * 2 }, (_, i) => (i % 3) - 1);
  const levels = {
    ranges: { pairs: depth, current: [sun.current] },
    frame: [1, 0, 0, -1, 0, 0, -1, 0, 0],
    depth: sun.ranges[sun.current],
    origins,
    finest: [sun.finest],
  } as unknown as SunLevels;
  pack.writeSun(0, levels, sun.levels, sun.tableBase);
  const floats = pack.records.subarray(0, SHADOW_RECORD_FLOATS),
    ints = new Int32Array(pack.records.buffer, 0, SHADOW_RECORD_FLOATS),
    f = (i: number) => floats[i];
  return {
    faces: truncating((m) => truncating((c) => pairs(f, m * 16 + c * 4))),
    frame: [0, 1, 2].map((row) => ({
      xyz: f(SHADOW_RECORD_FRAME + row * 4),
      w: f(SHADOW_RECORD_FRAME + row * 4 + 3),
    })),
    origins: truncating((k) => pairs((i) => ints[i], SHADOW_RECORD_ORIGINS + k * 4)),
    info: Object.fromEntries([...'xyzw'].map((c, i) => [c, f(SHADOW_RECORD_INFO + i)])),
  };
}

/** A readable page word: its physical page and the depth range slot it was drawn in. */
export const pageWord = (physical: number, slot: number) =>
  (PAGE_VALID | (physical & 0xffff) | (slot << PAGE_RANGE_SHIFT)) >>> 0;

/** The page table: `empty` of the pages unreadable, the rest drawn in `slotOf(h)`, all hashed
 *  from the map and the page so that develop's and the shipped read meet the same table. */
export const pageTable =
  (seed: number, empty: number, slotOf: (h: number) => number) => (base: number, page: number) => {
    const h = hash(seed ^ Math.imul(base, 7919) ^ Math.imul(page, 104729));
    return h < empty ? 0 : pageWord(Math.floor(h * 65536), slotOf(hash(Math.floor(h * 2 ** 31))));
  };

type Factor = { sunShadowFactor: (index: number, P: number, N: number, taps: boolean) => number };
type Range = { sunRangeReference: (index: number, drawn: number, z: number) => number };

/** `sunRangeReference` of the shipped text over `record`. */
export const rangeReference = (record: object) =>
  shaderFunctions<Range>(SHADOW_WGSL, ['sunRangeReference'], {
    ...wgslConstants(SHADOW_WGSL),
    shadows: { records: [record] },
  }).sunRangeReference;

/** `sunShadowFactor` of `source` over `record` and the page table `word`: what it hands the PCF,
 *  `sunRangeReference` (the shipped one, spied) and the far ray, and its answer. */
export function sunRead(
  source: string,
  record: ReturnType<typeof sunRecord>,
  word: (base: number, page: number) => number,
  at: { P: number; N: number; footprint: number; lane: 0 | 1; taps: boolean },
) {
  const { footprint, lane } = at;
  const pcf: unknown[][] = [],
    ranged: number[][] = [],
    far: unknown[][] = [],
    shipped = rangeReference(record);
  const scope = {
    ...wgslConstants(SHADOW_WGSL),
    shadows: { records: [record] },
    shadowFootprint: footprint,
    dot: (a: number, b: number) => a * b,
    clamp: (x: number, low: number, high: number) => Math.min(Math.max(x, low), high),
    sqrt: Math.sqrt,
    floor: Math.floor,
    log2: Math.log2,
    exp2: (x: number) => 2 ** x,
    i32: Math.trunc,
    vec2f: (x: number, y: number) => (lane ? y : x),
    vec2i: (x: number) => x,
    ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
      base,
      ring,
      pages,
      ox,
      oy,
    }),
    shadowPageWord: (map: { base: number }, home: number) => word(map.base, home),
    shadowPcf: (...args: unknown[]) => pcf.push(args) / 64,
    sunRangeReference: (...args: [number, number, number]) => {
      const reference = shipped(...args);
      ranged.push([...args, reference]);
      return reference;
    },
    sunFarShadowFactor: (...args: unknown[]) => (far.push(args), 0.25),
  };
  const names = ['sunShadowFactor', 'shadowNormalTexels', 'shadowDepthMargin', 'shadowRing'];
  const read = shaderFunctions<Factor>(source, [...names, 'sunOrigin'], scope).sunShadowFactor;
  return { factor: read(0, at.P, at.N, at.taps), pcf, ranged, far };
}
