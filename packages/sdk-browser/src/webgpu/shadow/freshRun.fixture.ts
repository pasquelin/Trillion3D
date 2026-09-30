// The pages the GPU draws itself (#1275), run from their shipped WGSL through `shaderRun`: the
// compose and the seal over the bytes their bindings hold, lane after lane as their barriers order
// them, and the pair cull over every row and region it dispatches — what the mock GPU dispatches
// (`tests/kit/gpu/mockCompute.ts`) and the scheduling tests run.
import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import {
  runShadowAllocation,
  runShadowFloors,
  runShadowWords,
  shadowsOf,
} from './allocRun.fixture.ts';
import { SHADOW_FRESH_CULL_WGSL } from './freshCullWgsl.ts';
import { FRESH_ARG, FRESH_PARAM_WORDS, FRESH_SLICE_FLOATS } from './freshLayout.ts';
import { POOL_COUNTS } from './poolWgsl.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelSignatures.ts';
import { FRESH_LANES } from './freshLanes.ts';
import { SHADOW_FRESH_WGSL } from '../../gpu/core/shaderTexts.fixture.ts';

const u32 = (b: Uint8Array) => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
const f32 = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
type Lanes = Record<string, (...args: number[]) => void>;
/** A pointer's word, as the kernels' atomics and `workgroupUniformLoad` read it. */
type Ref = { get: () => number; set: (value: number) => void };

/** The parameters the host wrote (`writeFresh`), as the kernels read them. */
function paramsOf(params: Uint8Array) {
  const words = u32(params),
    floats = f32(params);
  const slice = (s: number) => {
    const at = FRESH_PARAM_WORDS + s * FRESH_SLICE_FLOATS;
    return { emitter: [...floats.subarray(at, at + 4)], far: [...floats.subarray(at + 4, at + 8)] };
  };
  const [pages, side, layers, rows, blendFirst, blendEnd, capacity] = words;
  return {
    ...{ pages, side, layers, rows, blendFirst, blendEnd, capacity },
    slices: Array.from({ length: MAX_SHADOW_SLICES }, (_, s) => slice(s)),
  };
}

const FUNCTIONS = [
  'composeShadowPages',
  'sealShadowPages',
  'pickPages',
  'cropped',
  'along3',
  'composeSun',
  'shadowConeAxis',
  'shadowConeSpread',
  'composeLamp',
  'composeRegion',
  'freshDraw',
  'poolAt',
  'shadowPoolPages',
  'poolLayer',
  'faceVec',
  'volumeVec',
  'shadowPoolPlace',
  ...PAGE_MODEL_FUNCTIONS,
];

/**
 * Runs `entry` — `composeShadowPages` or `sealShadowPages` — over its bindings' bytes, in binding
 * order: the shadow buffer, the GPU pool, the draw list, the views, the volumes, the arguments, the
 * parameters and the cull's dispatch.
 */
export function runShadowFresh(entry: string, ...bound: Uint8Array[]) {
  const [data, state, drawList, faces, volumes, args, params, dispatch] = bound,
    counts = u32(state);
  const lanes = shaderRun<Lanes>(SHADOW_FRESH_WGSL, FUNCTIONS, {
    ...wgslConstants(SHADOW_FRESH_WGSL),
    shadows: shadowsOf(data),
    shadowPool: { pages: new Int32Array(state.buffer, state.byteOffset + POOL_COUNTS.length * 4) },
    countRead: (i: number) => counts[i],
    drawList: u32(drawList),
    faces: u32(faces),
    volumes: u32(volumes),
    args: u32(args),
    params: paramsOf(params),
    dispatch: dispatch ? u32(dispatch) : new Uint32Array(3),
    faceF: (i: number, v: number) => void (f32(faces)[i] = v),
    volumeF: (i: number, v: number) => void (f32(volumes)[i] = v),
    layerCount: new Uint32Array(16),
    regionCount: 0,
    workgroupUniformLoad: (p: Ref) => p.get(),
    storageBarrier: () => {},
  });
  for (let lane = 0; lane < FRESH_LANES; lane++) lanes[entry](lane);
}

/**
 * Runs `shadowCullPairs` over its bindings' bytes, in binding order — the spheres, the
 * parameters, the volumes, the pairs, the arguments and the rows' mobility —, every invocation of
 * the dispatch the arguments say.
 */
export function runShadowPairs(...bound: Uint8Array[]) {
  const [spheres, params, volumes, pairs, args, mobility] = bound,
    sphereFloats = f32(spheres),
    faceFloats = f32(volumes),
    faceWords = u32(volumes),
    words = u32(args);
  const face = (k: number) => {
    const at = (i: number) => k * 20 + i,
      vec = (i: number) => [...faceFloats.subarray(at(i), at(i) + 3)];
    return {
      ...{ center: vec(0), far: faceFloats[at(3)], axis: vec(4), halfAngle: faceFloats[at(7)] },
      ...{ right: vec(8), halfU: faceFloats[at(11)], up: vec(12), halfV: faceFloats[at(15)] },
      casters: faceWords[at(16)],
    };
  };
  const { shadowCullPairs } = shaderRun<Lanes>(
    SHADOW_FRESH_CULL_WGSL,
    ['shadowCullPairs', 'freshRow', 'keepPair', 'sphereTouches'],
    {
      ...wgslConstants(SHADOW_FRESH_CULL_WGSL),
      spheres: new Proxy([], {
        get: (_, row) => {
          const at = 4 * Number(row);
          return { center: [...sphereFloats.subarray(at, at + 3)], radius: sphereFloats[at + 3] };
        },
      }),
      params: paramsOf(params),
      volumes: new Proxy([], { get: (_, k) => face(Number(k)) }),
      pairs: u32(pairs),
      args: words,
      mobility: u32(mobility),
    },
  );
  // Every invocation of the dispatch the compose wrote: a row, then the blended ones, by region.
  const { rows, blendFirst, blendEnd } = paramsOf(params);
  for (let k = 0; k < words[FRESH_ARG.regions]; k++)
    for (let x = 0; x < rows + blendEnd - blendFirst; x++)
      (shadowCullPairs as unknown as (id: number[]) => void)([x, k, 0]);
}

/** The shadow passes run from their WGSL, by entry point, over their bindings' bytes in binding
 *  order: false for another entry point, which the caller runs. */
export function runShadowPass(
  entryPoint: string | undefined,
  group: { entries: Array<{ resource: { buffer?: { data: Uint8Array } } }> },
) {
  const bound = () => group.entries.map((entry) => entry.resource.buffer!.data);
  const run = {
    claimShadowFloors: () => runShadowFloors(...bound()),
    allocateShadowPages: () => runShadowAllocation(...bound()),
    applyShadowWords: () => runShadowWords(...(bound() as Parameters<typeof runShadowWords>)),
    composeShadowPages: () => runShadowFresh('composeShadowPages', ...bound()),
    sealShadowPages: () => runShadowFresh('sealShadowPages', ...bound()),
    shadowCullPairs: () => runShadowPairs(...bound()),
  }[entryPoint ?? ''];
  run?.();
  return !!run;
}
