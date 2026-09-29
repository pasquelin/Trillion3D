// #991: the sun's page read, run from its shipped WGSL through `shaderRun`, beside develop's before
// #991 (654d1311f), which read every page at one reference. The record the shader reads is the
// one `createShadowRecordPack().writeSun` packs, its arrays read as the WGSL struct lays them out.
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
  SUN_LEVELS,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createShadowRecordPack } from '../../gpu/shadow/recordPack.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { hash } from './shadowPages.fixture.ts';
import { SHADOW_SUBTEXELS } from './shadowSampleWgsl.ts';
import { directShadowWgsl } from './shadowWgsl.ts';

/** The shipped shadow read: `shadowPcf`, its helpers, and `SHADOW_FACTOR_WGSL` after them. */
export const SHADOW_WGSL = directShadowWgsl(0, null, 1);

/** Its literal constants, and `SHADOW_SUBTEXEL`, which it computes from one of them. */
export const CONSTANTS: Record<string, number> = {
  ...wgslConstants(SHADOW_WGSL),
  SHADOW_SUBTEXEL: 1 / SHADOW_SUBTEXELS,
};

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

export type Vec3 = [number, number, number];

export type Sun = {
  /** `zNear, zFar` of each slot, `SUN_DEPTH_RANGES` of them. */
  ranges: Array<[number, number]>;
  current: number;
  levels: number;
  finest: number;
  tableBase: number;
  /** The light's frame, orthonormal: `right`, `up`, then `axis`, toward which depth grows. */
  frame: [Vec3, Vec3, Vec3];
};

/** The sun's record as `writeSun` packs it, read as the WGSL struct lays it out: six matrices of
 *  four columns, three frame rows, the origins' vec4i, the header. */
export function sunRecord(sun: Sun) {
  const pack = createShadowRecordPack(256, 8),
    depth = new Float32Array(SUN_DEPTH_RANGES * 2);
  sun.ranges.forEach(([near, far], slot) => depth.set([near, far], slot * 2));
  const levels = {
    ranges: { pairs: depth, current: [sun.current] },
    frame: sun.frame.flat(),
    depth: sun.ranges[sun.current],
    origins: Array.from({ length: sun.levels * 2 }, (_, i) => (i % 3) - 1),
    finest: [sun.finest],
  } as unknown as SunLevels;
  pack.writeSun(0, levels, sun.levels, sun.tableBase);
  const floats = pack.records.subarray(0, SHADOW_RECORD_FLOATS),
    ints = new Int32Array(pack.records.buffer, 0, SHADOW_RECORD_FLOATS),
    vec4 = (from: ArrayLike<number>, at: number) =>
      Array.from({ length: 4 }, (_, i) => from[at + i]);
  return {
    faces: Array.from({ length: 6 }, (_, m) =>
      Array.from({ length: 4 }, (_, c) => vec4(floats, m * 16 + c * 4)),
    ),
    frame: [0, 1, 2].map((row) => vec4(floats, SHADOW_RECORD_FRAME + row * 4)),
    origins: Array.from({ length: SUN_LEVELS / 2 }, (_, k) =>
      vec4(ints, SHADOW_RECORD_ORIGINS + k * 4),
    ),
    info: vec4(floats, SHADOW_RECORD_INFO),
  };
}

/** The shader's module scope over one record: its constants and the shadow buffer. */
export const recordScope = (record: object) => ({ ...CONSTANTS, shadows: { records: [record] } });

/** A readable page word: its physical page and the depth range slot it was drawn in. */
export const pageWord = (physical: number, slot: number) =>
  (PAGE_VALID | (physical & 0xffff) | (slot << PAGE_RANGE_SHIFT)) >>> 0;

/** The page table: `empty` of the pages unreadable, the rest drawn in `slotOf(h)`, all hashed
 *  from the map and the page so that develop's and the shipped read meet the same table. */
export const pageTable =
  (seed: number, empty: number, slotOf: (h: number) => number) =>
  (base: number, [x, y]: number[]) => {
    const h = hash(seed ^ Math.imul(base, 7919) ^ Math.imul(x, 104729) ^ Math.imul(y, 1299709));
    return h < empty ? 0 : pageWord(Math.floor(h * 65536), slotOf(hash(Math.floor(h * 2 ** 31))));
  };

type Factor = { sunShadowFactor: (index: number, P: Vec3, N: Vec3, taps: boolean) => number };
type Range = { sunRangeReference: (index: number, drawn: number, z: number) => number };

/** `sunRangeReference` of the shipped text over `record`. */
export const rangeReference = (record: object) =>
  shaderRun<Range>(SHADOW_WGSL, ['sunRangeReference'], recordScope(record)).sunRangeReference;

const NAMES = [
  'sunShadowFactor',
  'shadowNormalTexels',
  'shadowDepthMargin',
  'shadowRing',
  'sunOrigin',
];

/** `sunShadowFactor` of `source` over `record` and the page table `word`: what it hands the PCF,
 *  `sunRangeReference` (the shipped one, spied) and the far ray, and its answer. */
export function sunRead(
  source: string,
  record: ReturnType<typeof sunRecord>,
  word: (base: number, page: number[]) => number,
  at: { P: Vec3; N: Vec3; footprint: number; taps: boolean },
) {
  const pcf: unknown[][] = [],
    ranged: number[][] = [],
    far: unknown[][] = [],
    shipped = rangeReference(record);
  const scope = {
    ...recordScope(record),
    shadowFootprint: at.footprint,
    ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
      base,
      ring,
      pages,
      ox,
      oy,
    }),
    shadowPageWord: (map: { base: number }, home: number[]) => word(map.base, home),
    shadowPcf: (...args: unknown[]) => pcf.push(args) / 64,
    sunRangeReference: (...args: [number, number, number]) => {
      const reference = shipped(...args);
      ranged.push([...args, reference]);
      return reference;
    },
    sunFarShadowFactor: (...args: unknown[]) => (far.push(args), 0.25),
  };
  const read = shaderRun<Factor>(source, NAMES, scope).sunShadowFactor;
  return { factor: read(0, at.P, at.N, at.taps), pcf, ranged, far };
}
