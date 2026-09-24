import { screenErrorVariant } from '../../../../sdk-core/src/index.ts';
import { mathBatchWasm } from '../../math/batchState.ts';
import type { SdkWasm } from '../decode/geometryPageWasm.ts';
import { reserveArena, type Arena } from '../decode/wasmArena.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './state.ts';

/**
 * The cut's node walk in the SDK WebAssembly module (`packages/page-codec-wasm/src/cut.rs`): the
 * descent of `traverse` without its pages, which returns the leaves it reaches in visiting order.
 * `visit.ts` then takes their pages as its own descent would have: same order, same bits.
 *
 * The hierarchy crosses once. A primitive's nodes and bounds are fixed at prepare time and shared
 * by all its placements (`template.ts`): they are copied into module memory at their first walk,
 * kept as long as the nodes live, and released with them. Only the lens — planes, view, five
 * scalars — is written per walk.
 */

type Culling = { nodes: Float64Array; stride: number; bounds: Float64Array };

/** Governor name of the walk (`batchLot.ts::joue`). */
export const CUT_WALK = 'cutWalk';
/** Lens block of `cut_walk`: 24 plane floats, 16 view floats, 6 scalars. */
const LENS_VALUES = 46;

type Held = { bounds: Float64Array; arena: Arena };
const held = new WeakMap<Float64Array, Held>();
const release = new FinalizationRegistry<Arena>((arena) => arena.libere());
/** Lens, result and stack: one reservation for the session's walks. */
let scratch: Arena | null = null;
/** Walks run to the end, and walks handed back to the JavaScript descent (`cut.rs::Bail`). */
export const cutWalkRuns = { walked: 0, bailed: 0 };
/** Leaves copied out of module memory: taking a page may grow it and detach the view. */
let leaves = new Uint32Array(64);

/** The module when the walk may run now: loaded, carrying the kernel, on the certified metric. */
export function cutWalkModule(): SdkWasm | null {
  const wasm = mathBatchWasm();
  return wasm && typeof wasm.cut_walk === 'function' && screenErrorVariant() === 'certifiee'
    ? wasm
    : null;
}

/** The hierarchy's copy in module memory — nodes, bounds, leaf list — made at its first walk. */
function residentOf(wasm: SdkWasm, culling: Culling, count: number) {
  const known = held.get(culling.nodes);
  if (known?.bounds === culling.bounds) return known.arena;
  if (known) {
    release.unregister(known);
    known.arena.libere();
  }
  const arena = reserveArena(wasm, [
    { type: 'f64', longueur: culling.nodes.length },
    { type: 'f64', longueur: culling.bounds.length },
    { type: 'u32', longueur: count },
  ]);
  if (!arena) return null;
  const [nodes, bounds] = arena.blocs();
  nodes.vue.set(culling.nodes);
  bounds.vue.set(culling.bounds);
  const entry = { bounds: culling.bounds, arena };
  held.set(culling.nodes, entry);
  release.register(culling.nodes, arena, entry);
  return arena;
}

function scratchOf(wasm: SdkWasm) {
  scratch ??= reserveArena(wasm, [
    { type: 'f64', longueur: LENS_VALUES },
    { type: 'u32', longueur: 3 },
    { type: 'u32', longueur: selectionScratch.stack.length },
  ]);
  return scratch;
}

/**
 * Walks `culling` under the frame lens of `s`: adds its node counters to `s` and returns the
 * number of leaves written to `cutLeaves()`, or -1 when the JavaScript descent must run — no
 * room in module memory, or a hierarchy or lens outside the kernel's domain (`cut.rs`).
 */
export function walkCut<T extends PageRecord>(
  wasm: SdkWasm,
  s: SelectionState<T>,
  culling: Culling,
): number {
  const { nodes, stride, bounds } = culling;
  const count = Math.floor(nodes.length / stride);
  if (!Number.isInteger(stride) || count < 1) return -1;
  const resident = residentOf(wasm, culling, count),
    work = scratchOf(wasm);
  if (!resident || !work) return -1;
  const [lensBlock, resultBlock, stackBlock] = work.blocs();
  const lens = lensBlock.vue;
  lens.set(selectionScratch.planes);
  lens.set(s.flatElements, 24);
  const perspective = s.cam.perspective;
  lens[40] = s.flatStretch;
  lens[41] = s.flatFocal;
  lens[42] = s.cam.near;
  lens[43] = perspective === undefined ? 1 : perspective;
  lens[44] = s.pixelError;
  lens[45] = s.flatExact ? 1 : 0;
  const [nodesBlock, boundsBlock, leafBlock] = resident.blocs();
  const status = wasm.cut_walk(
    nodesBlock.offset,
    nodes.length,
    stride,
    boundsBlock.offset,
    bounds.length,
    lensBlock.offset,
    stackBlock.offset,
    stackBlock.vue.length,
    leafBlock.offset,
    count,
    resultBlock.offset,
  );
  if (status !== 0) {
    cutWalkRuns.bailed++;
    return -1;
  }
  cutWalkRuns.walked++;
  const [written, tested, rejected] = resultBlock.vue;
  s.nodesTested += tested;
  s.frustumRejected += rejected;
  if (leaves.length < written) leaves = new Uint32Array(written);
  leaves.set(leafBlock.vue.subarray(0, written));
  return written;
}

/** The leaves of the last walk: `node << 2 | settled << 1 | inside`, in visiting order. */
export const cutLeaves = () => leaves;
