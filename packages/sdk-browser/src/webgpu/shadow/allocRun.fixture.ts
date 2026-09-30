// The GPU allocation of shadow pages and the host's table words (#1275), run from their shipped
// WGSL through `shaderRun`, over the bytes of the buffers they bind: phase by phase, every lane of
// a phase before the next, as the barriers of `allocateShadowPages` order them. What the mock GPU
// dispatches (`tests/kit/gpu/mockCompute.ts`) and the scheduling tests run.
import {
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SHADOW_RECORD_FLOATS,
} from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_RECORD_FRAME,
  SHADOW_RECORD_INFO,
  SHADOW_RECORD_ORIGINS,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { SUN_LEVELS } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { ALLOC_PARAM_WORDS } from './allocWgsl.ts';
import { POOL_COUNTS } from './poolWgsl.ts';
import { WORDS_HEADER } from './wordsWgsl.ts';
import { shadowRequestBits } from '../../lighting/direct/shadowRequestWgsl.ts';
import { allocationWgsl } from './allocWgsl.ts';
import { shadowWordsWgsl } from './wordsWgsl.ts';

const SHADOW_REQUEST_BITS = shadowRequestBits();
const ALLOCATION_WGSL = allocationWgsl();
const ALLOC_LANES = 256;
const ALLOC_PHASES = ['followPages', 'touchRequests', 'listCandidates'];
const SHADOW_WORDS_WGSL = shadowWordsWgsl();

type Lanes = Record<string, (...args: number[]) => void>;
const u32 = (b: Uint8Array) => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
const i32 = (b: Uint8Array, at = 0) =>
  new Int32Array(b.buffer, b.byteOffset + at * 4, (b.byteLength >> 2) - at);

/** The records and the page table of the shadow buffer `data`, as the kernels read them. */
export function shadowsOf(data: Uint8Array) {
  const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2),
    ints = i32(data);
  const records = Array.from({ length: MAX_SHADOW_SLICES }, (_, slice) => {
    const at = slice * SHADOW_RECORD_FLOATS,
      origins = at + SHADOW_RECORD_ORIGINS,
      frame = at + SHADOW_RECORD_FRAME;
    return {
      faces: Array.from(
        { length: POINT_FACES },
        (_, f) => new Mat([...floats.subarray(at + 16 * f, at + 16 * f + 16)]),
      ),
      frame: [0, 4, 8].map((row) => [...floats.subarray(frame + row, frame + row + 4)]),
      info: [...floats.subarray(at + SHADOW_RECORD_INFO, at + SHADOW_RECORD_INFO + 4)],
      origins: Array.from({ length: SUN_LEVELS / 2 }, (_, k) => [
        ...ints.subarray(origins + 4 * k, origins + 4 * k + 4),
      ]),
    };
  });
  return { records, table: u32(data).subarray(SHADOW_TABLE_OFFSET / 4) };
}

/** `requestShadowPage` on the request buffer `requests`: page `e`'s bit claimed, and the page
 *  listed by whoever set it. */
export function claimShadowRequest(requests: Uint8Array, e: number) {
  const list = u32(requests),
    cap = list.length - 1 - SHADOW_REQUEST_BITS,
    word = 1 + cap + (e >>> 5),
    bit = 1 << (e & 31);
  if (list[word] & bit) return;
  list[word] |= bit;
  const at = list[0]++;
  if (at < cap) list[1 + at] = e;
}

/** The atomics the kernels call through, over the pool's counts and the request buffer. */
function atomicsOf(state: Uint8Array, requests: Uint8Array) {
  const counts = u32(state),
    list = u32(requests);
  return {
    countOne: (i: number) => void counts[i]++,
    countNext: (i: number) => counts[i]++,
    countRead: (i: number) => counts[i],
    countClear: (i: number) => void (counts[i] = 0),
    requestCount: () => list[0],
    requestAt: (i: number) => list[1 + i],
    requestShadowPage: (e: number) => claimShadowRequest(requests, e),
  };
}

const FUNCTIONS = [
  'beginAllocation',
  ...ALLOC_PHASES,
  'listDraw',
  'padKeys',
  'sortStep',
  'assignPages',
  'shadowEntryPage',
  'poolAt',
  'shadowPoolPages',
  'sunOrigin',
  ...PAGE_MODEL_FUNCTIONS,
];
const vec4i = (...parts: number[]) => (parts.length === 1 ? new Array(4).fill(parts[0]) : parts);

/** `allocateShadowPages`' lanes over the bytes its bindings hold, in binding order: the shadow
 *  buffer, the request buffer, the GPU pool, the keys, the parameters and the draw list. */
function allocationLanes(...bound: Uint8Array[]) {
  const [data, requests, state, keys, params, drawList] = bound,
    words = u32(params);
  return shaderRun<Lanes>(ALLOCATION_WGSL, FUNCTIONS, {
    ...wgslConstants(ALLOCATION_WGSL),
    ...atomicsOf(state, requests),
    vec4i,
    shadows: shadowsOf(data),
    shadowPool: { pages: i32(state, POOL_COUNTS.length) },
    keys: u32(keys),
    drawList: u32(drawList),
    params: {
      frame: i32(params)[0],
      pages: words[1],
      listCap: words[2],
      asks: words[3],
      candidateBase: words[4],
      generation: words.subarray(8, 8 + MAX_SHADOW_SLICES),
      entries: words.subarray(ALLOC_PARAM_WORDS),
    },
  });
}

/** Runs `claimShadowFloors` over the bytes its bindings hold, as `runShadowAllocation`. */
export function runShadowFloors(...bound: Uint8Array[]) {
  const { beginAllocation } = allocationLanes(...bound);
  for (let lane = 0; lane < ALLOC_LANES; lane++) beginAllocation(lane);
}

/**
 * Runs `allocateShadowPages` over the bytes its bindings hold, in binding order: the shadow
 * buffer, the request buffer, the GPU pool, the keys, the parameters and the draw list.
 */
export function runShadowAllocation(...bound: Uint8Array[]) {
  const [, , state, , params] = bound,
    words = u32(params),
    lanes = allocationLanes(...bound);
  const each = (phase: string, ...args: number[]) => {
    for (let lane = 0; lane < ALLOC_LANES; lane++) lanes[phase](lane, ...args);
  };
  for (const phase of ALLOC_PHASES) each(phase);
  const counts = u32(state),
    [needs, candidates] = [counts[0], counts[1]];
  if (!needs) return;
  const span = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
  for (const [base, count] of [
    [0, needs],
    [words[4], candidates],
  ]) {
    each('padKeys', base, count, span(count));
    for (let k = 2; k <= span(count); k *= 2)
      for (let j = k / 2; j > 0; j /= 2) each('sortStep', base, span(count), k, j);
  }
  each('assignPages', needs, candidates);
}

/** Runs `applyShadowWords` over the shadow buffer, the GPU pool, the host's words and the draw
 *  list. */
export function runShadowWords(
  data: Uint8Array,
  state: Uint8Array,
  words: Uint8Array,
  drawList: Uint8Array = new Uint8Array(4 * (u32(words)[1] || 1)),
) {
  const sent = u32(words),
    shadowWords = {
      count: sent[0],
      pages: sent[1],
      frame: i32(words)[2],
      words: Array.from({ length: sent[0] }, (_, i) => [
        sent[WORDS_HEADER + 2 * i],
        sent[WORDS_HEADER + 2 * i + 1],
      ]),
    };
  const { applyShadowWord } = shaderRun<Lanes>(
    SHADOW_WORDS_WGSL,
    ['applyShadowWord', 'loseDepth', 'listDraw', 'poolAt', 'shadowPoolPages'],
    {
      ...wgslConstants(SHADOW_WORDS_WGSL),
      ...atomicsOf(state, new Uint8Array(4)),
      shadows: shadowsOf(data),
      shadowPool: { pages: i32(state, POOL_COUNTS.length) },
      shadowWords,
      drawList: u32(drawList),
    },
  );
  for (let i = 0; i < shadowWords.count; i++) applyShadowWord(i);
}
