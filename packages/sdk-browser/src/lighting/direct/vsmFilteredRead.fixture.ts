// The world a blended or water shadow read runs over (`vsmFilteredRead.test.ts`): page entries, the
// pool, the transmission atlas, and the shipped WGSL run in JavaScript.
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { directShadowWgsl } from './shadowWgsl.ts';

export type V = number[];
export const PAGE = 128;
export const LEVEL = 16384;
/** The first full map's id: the handle every test reads. */
export const MAP = 8192;

export interface Entry {
  physicalAddress: V;
  coarserLevels: number;
  anyLevelMapped: boolean;
  thisLevelMapped: boolean;
}
const UNMAPPED: Entry = {
  physicalAddress: [0, 0],
  coarserLevels: 0,
  anyLevelMapped: false,
  thisLevelMapped: false,
};
export const mapped = (physicalAddress: V): Entry => ({
  physicalAddress,
  coarserLevels: 0,
  anyLevelMapped: true,
  thisLevelMapped: true,
});
/** An entry whose page only a level `coarserLevels` coarser holds. */
export const coarser = (coarserLevels: number, physicalAddress: V = [0, 0]): Entry => ({
  physicalAddress,
  coarserLevels,
  anyLevelMapped: true,
  thisLevelMapped: false,
});

/** The maps under a test: page entries by map, level and page; the pool's depth at a physical
 *  texel; clipmap levels one coarser apart, `bias` their relative offset; what the translucent
 *  casters let through to the receiver (`vsmTransmissionThrough`, tested on its own). */
export class World {
  table = new Map<string, Entry>();
  depth: (physical: V) => number = () => 0;
  /** UV and depth offset of level `id + 1` relative to `id`. */
  bias: V = [0.125, 0.25, 0.01];
  through: V = [1, 1, 1];
  /** The receivers the transmission was read for. */
  throughReads = 0;
  lookups: string[] = [];
  set(id: number, mip: number, page: V, entry: Entry) {
    this.table.set(`${id}:${mip}:${page}`, entry);
  }
  /** The page of level `id + offset` holding page `page` of level `id`. */
  coarsePage(page: V, offset: number) {
    return page.map((p, a) =>
      Math.floor(((p * PAGE + PAGE / 2) * 2 ** -offset + this.bias[a] * offset * LEVEL) / PAGE),
    );
  }
}

/** A blended surface's read as the blend and water stages compose it — the program variant with
 *  the traced read, so that every mode is there —, and two test probes. */
export const SOURCE = `${directShadowWgsl(null, 18, undefined, true)}
fn testTransmission()->vec3f{return shadowTransmission;}
fn testReset(){shadowTransmission=vec3f(1.0);}`;

/** The shipped taps, read back from the WGSL. */
export const TAPS = [
  .../const VSM_FILTER_TAPS:array<vec2f,16>=array<vec2f,16>\(([^;]+)\);/
    .exec(SOURCE)![1]
    .matchAll(/vec2f\(([^,]+),([^)]+)\)/g),
].map((m) => [Number(m[1]), Number(m[2])]);

const vector =
  (size: number) =>
  (...args: Array<number | V>) => {
    const flat = args.flat().map((x) => Math.trunc(Number(x)) >>> 0);
    return flat.length === 1 ? new Array<number>(size).fill(flat[0]) : flat;
  };
const each = (f: (x: number) => number) => (v: number | V) => (Array.isArray(v) ? v.map(f) : f(v));

/** The module run over `world`, with `extra` scope entries (stubs) and `uniforms` overrides. */
export function run<T>(
  world: World,
  names: string[],
  extra: object = {},
  uniforms: object = {},
  source = SOURCE,
) {
  const scope = {
    VSM_LOG2_PAGE: 7,
    VSM_PAGE_TEXELS: PAGE,
    VSM_PAGE_TEXEL_MASK: PAGE - 1,
    VSM_LEVEL0_TEXELS: LEVEL,
    VSM_FILTER_TAPS: TAPS,
    VSM_NOISE_TILE: [64, 64, 64],
    VSM_NORMAL_OFFSET_FLOOR: 0.0002,
    LIGHT_KIND_SPOT: 2,
    KIND_SPOT: 1,
    vsm: {
      poolPages: 2048,
      poolPagesXY: [128, 16],
      normalBias: 0.0005,
      translucentShadowFilter: 1,
      screenRayShare: 0.015,
      viewTanHalfFovY: 0.5,
      frameStamp: 3,
      ...uniforms,
    },
    shadowTransmission: [1, 1, 1],
    shadowCamera: [0, 0, 0],
    shadowAngularPixel: 0.001,
    shadowViewWidth: 1000,
    shadowFootprint: 0.01,
    shadowPixel: [100.5, 60.5],
    vsmView: {},
    _: 0,
    vsmTransmissionThrough: () => (world.throughReads++, world.through),
    vec4u: vector(4),
    fract: each((x) => x - Math.floor(x)),
    mat4x4f: (...columns: V[]) => new Mat(columns.flat()),
    VsmFilterPage: (
      kind: number,
      physical: V,
      first: V,
      texelScale: number,
      texelBias: V,
      depthInverse: number,
      depthBias: number,
    ) => ({
      kind,
      physical,
      first,
      texelScale,
      texelBias,
      depthInverse,
      depthBias,
    }),
    VsmProjectionLight: (...fields: unknown[]) => ({ fields }),
    VsmFilterTexel: (physical: V, centre: V) => ({ physical, centre }),
    vsmTexelsAtLevel: (mip: number) => LEVEL >> mip,
    vsmHandleOffset: (h: { id: number }, offset: number) => ({ ...h, id: h.id + offset }),
    vsmTableEntryOf: (h: { id: number }, mip: number, page: V) => `${h.id}:${mip}:${page}`,
    vsmTableEntryAtOffset: (key: string) => {
      world.lookups.push(key);
      return world.table.get(key) ?? UNMAPPED;
    },
    vsmPoolDepth: (physical: V) => world.depth(physical),
    // Level `id + offset` relative to `id`: UV scaled by 2^-offset then offset, depth likewise.
    vsmLevelToLevelOf: (_h: { id: number }, offset: number) => {
      const scale = 2 ** -offset;
      return { scale, bias: world.bias.map((b) => b * offset), depthInverse: 2 ** offset };
    },
    vsmCoarserLevelPage: (page: V, _h: { id: number }, offset: number) =>
      world.coarsePage(page, offset),
    ...extra,
  };
  return shaderRun<T>(source, names, scope);
}
