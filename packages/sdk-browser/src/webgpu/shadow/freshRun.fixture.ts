// The pages the GPU draws itself (#1275), run from their shipped WGSL through `shaderRun`: the
// compose pass over the bytes its bindings hold, lane after lane as its one barrier orders them,
// and the region cull's `keepCaster` over a region's volume — what the mock GPU dispatches
// (`tests/kit/gpu/mockCompute.ts`) and the scheduling tests run.
import { MAX_SHADOW_SLICES, SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { SHADOW_CULL_SHADER } from '../../gpu/shadow/cullShader.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { runShadowAllocation, runShadowWords, shadowsOf } from './allocRun.fixture.ts';
import {
  FRESH_LANES,
  FRESH_PARAM_WORDS,
  FRESH_SLICE_FLOATS,
  MAX_POOL_LAYERS,
  SHADOW_FRESH_WGSL,
} from './freshWgsl.ts';
import { POOL_COUNTS } from './poolWgsl.ts';

const u32 = (b: Uint8Array) => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
const f32 = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);

const FUNCTIONS = [
  'composeShadowPages',
  'pickPages',
  'composeRegion',
  'composeSun',
  'composeLamp',
  'crop',
  'coneDirection',
  'faceVec',
  'volumeVec',
  'poolField',
  'shadowPoolPlace',
  ...PAGE_MODEL_FUNCTIONS,
];

/** The parameters the host wrote (`writeFresh`), as the kernel reads them. */
function paramsOf(params: Uint8Array) {
  const words = u32(params),
    floats = f32(params);
  const slice = (s: number) => {
    const at = FRESH_PARAM_WORDS + s * FRESH_SLICE_FLOATS;
    return { emitter: [...floats.subarray(at, at + 4)], far: [...floats.subarray(at + 4, at + 8)] };
  };
  return {
    pages: words[0],
    side: words[1],
    layers: words[2],
    perLayer: words[3],
    rows: words[4],
    slices: Array.from({ length: MAX_SHADOW_SLICES }, (_, s) => slice(s)),
  };
}

/**
 * Runs `composeShadowPages` over its bindings' bytes, in binding order: the shadow buffer, the GPU
 * pool, the draw list, the faces, the cull volumes and commands, the parameters and the cull's
 * dispatch arguments. Returns the page each region drew, −1 for none.
 */
export function runShadowFresh(...bound: Uint8Array[]) {
  const [data, state, drawList, faces, volumes, commands, params, args] = bound,
    regionPage = new Int32Array(MAX_SHADOW_REGIONS);
  const { composeShadowPages } = shaderRun<Record<string, (lane: number) => void>>(
    SHADOW_FRESH_WGSL,
    FUNCTIONS,
    {
      ...wgslConstants(SHADOW_FRESH_WGSL),
      shadows: shadowsOf(data),
      shadowPool: {
        counts: u32(state).subarray(0, POOL_COUNTS.length),
        pages: new Int32Array(state.buffer, state.byteOffset + POOL_COUNTS.length * 4),
      },
      drawList: u32(drawList),
      faces: u32(faces),
      volumes: u32(volumes),
      commands: u32(commands),
      params: paramsOf(params),
      args: u32(args),
      faceF: (i: number, v: number) => void (f32(faces)[i] = v),
      volumeF: (i: number, v: number) => void (f32(volumes)[i] = v),
      regionPage,
      layerCount: new Uint32Array(MAX_POOL_LAYERS),
      workgroupBarrier: () => {},
    },
  );
  for (let lane = 0; lane < FRESH_LANES; lane++) composeShadowPages(lane);
  return regionPage;
}

/** A caster row: its world sphere, and its mobility word (`MOBILITY_*`). */
export type CasterRow = { center: number[]; radius: number; mobility?: number };

/**
 * The rows region `region` keeps of `rows`, by the region cull over every row (`shadowCullScatter`
 * with no list, as `freshPass.ts` dispatches it) against the volume `volumes` holds for it: its two
 * lists, the casters no fragment cuts, then the cutouts.
 */
export function keptRows(volumes: Uint8Array, region: number, rows: CasterRow[]) {
  const floats = f32(volumes),
    words = u32(volumes),
    at = (k: number) => region * SHADOW_CULL_FLOATS + k,
    vec = (k: number) => [...floats.subarray(at(k), at(k) + 3)];
  const face = {
    center: vec(0),
    far: floats[at(3)],
    axis: vec(4),
    halfAngle: floats[at(7)],
    right: vec(8),
    halfU: floats[at(11)],
    up: vec(12),
    halfV: floats[at(15)],
    casters: words[at(16)],
  };
  const capacity = rows.length,
    kept = new Uint32Array(capacity),
    indirect = new Uint32Array(8);
  const { shadowCullScatter } = shaderRun<Record<string, (id: number[]) => void>>(
    SHADOW_CULL_SHADER,
    ['shadowCullScatter', 'listed', 'keepCaster', 'keptCount', 'keptCorners', 'keptAt'],
    {
      ...wgslConstants(SHADOW_CULL_SHADER),
      uni: { firstFace: 0, faces: 1, sourceBase: rows.length, capacity, identity: 1 },
      faces: [face],
      spheres: rows,
      mobility: rows.map((row) => row.mobility ?? 0),
      kept,
      indirect,
    },
  );
  rows.forEach((_, row) => shadowCullScatter([row, 0, 0]));
  return [...kept.subarray(0, indirect[1]), ...kept.subarray(capacity - indirect[5]).reverse()];
}

/** The shadow passes run from their WGSL, by entry point, over their bindings' bytes in binding
 *  order: false for another entry point, which the caller runs. */
export function runShadowPass(entryPoint: string | undefined, bound: Uint8Array[]) {
  const run = {
    allocateShadowPages: () =>
      runShadowAllocation(...(bound as Parameters<typeof runShadowAllocation>)),
    applyShadowWords: () => runShadowWords(...(bound as Parameters<typeof runShadowWords>)),
    composeShadowPages: () => runShadowFresh(...bound),
  }[entryPoint ?? ''];
  run?.();
  return !!run;
}
