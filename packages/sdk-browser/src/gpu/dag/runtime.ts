import {
  SELECTION_NONE as NONE,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type ResidencyChanges,
  type SelectionUniforms,
} from '../core/selection.ts';
import { RESIDENCY_RANGE_MAX, coalesceResidencyRanges } from '../../webgpu/residency/ranges.ts';
import { refreshWorldStretch, worldsChanged } from './worlds.ts';
import { residentBase, residentWords } from './layout.ts';
import { FRAME_VEC4 } from './types.ts';
import { createDagDispatch } from './dispatch.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * Requested residency, set as bits: one word for thirty-two clusters, which is by itself its
 * own mirror — the comparison rereads the bit it is about to write, with no parallel array.
 * Only pages the rank journal names are visited, all of them when it names none reliably.
 * `touched` receives the word ranks touched, increasing and without repetition: those are what
 * the top writes, not the pages. Returns their count.
 */
export function updateResidencyBits(
  next: Uint32Array,
  bits: Uint32Array,
  base: number,
  changes: ResidencyChanges | undefined,
  touched: Int32Array,
) {
  let count = 0,
    last = -1;
  const apply = (j: number) => {
    const word = j >>> 5,
      mask = 1 << (j & 31),
      current = bits[base + word];
    if (((current & mask) !== 0) === !!next[j]) return;
    bits[base + word] = next[j] ? current | mask : current & ~mask;
    if (word === last) return;
    touched[count++] = word;
    last = word;
  };
  if (changes?.sorted) for (let i = 0; i < changes.count; i++) apply(changes.pages[i]);
  else for (let j = 0; j < next.length; j++) apply(j);
  return count;
}

export function createDagRuntime(resources: DagResources): GpuSelection {
  const {
    device,
    packed,
    residentCut,
    pageCount,
    nodeCount,
    frameData,
    buffers,
    flags,
    worlds,
    frames,
    pageCones,
  } = resources;
  const state = {
    last: null as GpuCut | null,
    lastSubmitted: undefined as SelectionUniforms | undefined,
    lastReadback: undefined as SelectionUniforms | undefined,
    pending: Promise.resolve() as Promise<unknown>,
    disposed: false,
    dead: false,
    worldRevision: 0,
    residencyRevision: 0,
    submittedResidencyRevision: -1,
    readbackResidencyRevision: -1,
    submittedWorldRevision: -1,
    readbackWorldRevision: -1,
    mapped: [false, false],
    slot: 0,
  };
  /** Cuts in hand and in flight name pages the kernel may no longer choose: they are void. */
  const voidCuts = () => {
    state.residencyRevision++;
    state.last = null;
  };
  // A dead selection dispatches and drains nothing more.
  const fail = () => ((state.dead = true), voidCuts());
  const previousWorlds = packed.worlds.slice(),
    frameInts = new Uint32Array(frameData.buffer);
  // Residency bits extend the cold records, in the same buffer: the same view serves as
  // comparison mirror and write source, with no parallel array.
  const residentWord = residentBase(pageCount),
    bits = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    );
  /** Words the last apply actually changed, and the ranges that cover them. */
  const touched = new Int32Array(Math.max(1, residentWords(pageCount)));
  const ranges = new Int32Array(RESIDENCY_RANGE_MAX * 2);
  const dispatch = createDagDispatch(resources, state, fail);
  const selection: GpuSelection = {
    residentCut,
    maskBuffer: flags,
    maskOffset: nodeCount,
    pageCount,
    get worldRevision() {
      return state.worldRevision;
    },
    updateWorlds(next, posesMoved = true) {
      if (state.disposed || state.dead) return false;
      if (next.byteLength !== packed.worlds.byteLength)
        throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED');
      if (!worldsChanged(previousWorlds, next)) return false;
      // Stretch reads the linear part alone, which a moving origin leaves: read before the copy.
      const stretched = refreshWorldStretch(previousWorlds, next, packed, frameData);
      previousWorlds.set(next);
      packed.worlds.set(next);
      device.queue.writeBuffer(
        worlds,
        0,
        next.buffer as ArrayBuffer,
        next.byteOffset,
        next.byteLength,
      );
      if (stretched) device.queue.writeBuffer(frames, 0, frameData as Float32Array<ArrayBuffer>);
      // Cuts in hand and in flight keep the revision they were cut at, and still name what to
      // stream: dropping them left a model moved every frame with no cut at all (#358).
      if (posesMoved) state.worldRevision++;
      return true;
    },
    parkWorld(w, parked) {
      if (state.disposed || state.dead) return;
      const node = parked ? NONE : packed.rootBases[w];
      if (packed.rootNodes[w] === node) return;
      packed.rootNodes[w] = node;
      // The root travels behind the stretch in the frame buffer (`resources.ts`): one word.
      const at = (w * FRAME_VEC4 + 6) * 4 + 1;
      frameInts[at] = node;
      device.queue.writeBuffer(frames, at * 4, frameInts.buffer as ArrayBuffer, at * 4, 4);
      // Its pages leave the cut outright, neither streamed nor counted: another cut from here.
      voidCuts();
    },
    updateResidency(next, changes) {
      if (state.disposed || state.dead || !residentCut) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      const count = updateResidencyBits(next, bits, residentWord, changes, touched);
      if (!count) return false;
      // One write per contiguous word range, never one per page: what goes to the GPU is now
      // only one bit per cluster, and a thousand small writes are not worth the single one they
      // replace.
      const spans = coalesceResidencyRanges(touched, count, ranges);
      for (let r = 0; r < spans; r++) {
        const from = (residentWord + ranges[r * 2]) * 4,
          bytes = (ranges[r * 2 + 1] - ranges[r * 2] + 1) * 4;
        device.queue.writeBuffer(
          pageCones,
          from,
          packed.pageCones.buffer as ArrayBuffer,
          packed.pageCones.byteOffset + from,
          bytes,
        );
      }
      voidCuts();
      return true;
    },
    dispatch,
    peek() {
      return state.dead ? null : state.last;
    },
    failed() {
      return state.dead;
    },
    async flush() {
      await state.pending;
      if (
        residentCut &&
        !state.dead &&
        state.lastSubmitted &&
        state.submittedResidencyRevision === state.residencyRevision &&
        (!state.lastReadback ||
          !sameSelectionUniforms(state.lastReadback, state.lastSubmitted) ||
          state.readbackResidencyRevision !== state.residencyRevision ||
          state.readbackWorldRevision !== state.worldRevision)
      ) {
        // Cut again under the poses in place: a drain never hands back one they have left.
        selection.dispatch(state.lastSubmitted);
        await state.pending;
      }
      const last = state.dead ? null : state.last;
      return last?.worldRevision === state.worldRevision ? last.result : null;
    },
    dispose() {
      state.disposed = true;
      state.dead = true;
      state.pending = state.pending.catch(() => {});
      for (const buffer of buffers) buffer.destroy();
    },
  };
  return selection;
}
