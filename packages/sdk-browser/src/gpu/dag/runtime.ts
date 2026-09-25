import {
  SELECTION_NONE as NONE,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type ResidencyChanges,
  type SelectionUniforms,
} from '../core/selection.ts';
import { RESIDENCY_RANGE_MAX, coalesceResidencyRanges } from '../../webgpu/residency/ranges.ts';
import { primitiveWordAt, refreshWorldStretch, worldsChanged } from './worlds.ts';
import { childBase, residentBase, residentWords } from './layout.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import { createDagReadiness } from './readiness.ts';
import { createDagDispatch } from './dispatch.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * One of the cut rule's residency bit sets: one word for thirty-two clusters, which is by itself
 * its own mirror — the comparison rereads the bit it is about to write, with no parallel array.
 * Only pages `changes` names are visited, all of them when it names none reliably.
 * `touched` receives the word ranks touched, increasing and without repetition: those are what
 * the top writes, not the pages. Returns their count.
 */
export function updateResidencyBits(
  next: ArrayLike<number>,
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
    nodes,
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
  // Residency bits extend the cold records in their buffer: one view, mirror and write source.
  const bits = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    packed.pageCones.length,
  );
  // The cut rule's residency, derived from the pool's (`readiness.ts`).
  const readiness = residentCut ? createDagReadiness(packed) : undefined;
  /** Words the last apply actually changed, and the ranges that cover them. */
  const touched = new Int32Array(Math.max(1, residentWords(pageCount), nodeCount));
  const ranges = new Int32Array(RESIDENCY_RANGE_MAX * 2);
  /** Writes the ranges `count` sorted ranks of `touched` span, `stride` words each from `base`. */
  const upload = (target: GPUBuffer, source: Float32Array, base: number, stride: number, count: number) => {
    const spans = coalesceResidencyRanges(touched, count, ranges);
    for (let r = 0; r < spans; r++) {
      const from = (base + ranges[r * 2] * stride) * 4,
        bytes = (ranges[r * 2 + 1] - ranges[r * 2] + 1) * stride * 4;
      device.queue.writeBuffer(target, from, source.buffer as ArrayBuffer, source.byteOffset + from, bytes);
    }
  };
  const changed = { pages: new Int32Array(Math.max(1, pageCount)), count: 0, sorted: true };
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
      if (stretched) {
        device.queue.writeBuffer(frames, 0, frameData as Float32Array<ArrayBuffer>);
        resources.frameWrites.count++;
      }
      // Cuts in hand and in flight keep their revision and still name what to stream (#358).
      if (posesMoved) state.worldRevision++;
      return true;
    },
    parkWorld(w, parked) {
      if (state.disposed || state.dead) return;
      const node = parked ? NONE : packed.rootBases[w];
      if (packed.rootNodes[w] === node) return;
      packed.rootNodes[w] = node;
      // The root travels behind the stretch in the frame buffer (`resources.ts`): one word.
      const at = primitiveWordAt(w) + 1;
      frameInts[at] = node;
      device.queue.writeBuffer(frames, at * 4, frameInts.buffer as ArrayBuffer, at * 4, 4);
      resources.frameWrites.count++;
      // Its pages leave the cut outright, neither streamed nor counted: another cut from here.
      voidCuts();
    },
    updateResidency(next, changes) {
      if (state.disposed || state.dead || !readiness) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      const settled = readiness.apply(next, changes);
      if (!settled.pages.length && !settled.nodes.length) return false;
      // One write per contiguous range, never one per page or node: a thousand small writes are
      // not worth the single one they replace.
      changed.pages.set(settled.pages);
      changed.count = settled.pages.length;
      const words = [residentBase(pageCount), childBase(pageCount)];
      [readiness.ready, readiness.childReady].forEach((set, k) =>
        upload(pageCones, packed.pageCones, words[k], 1, updateResidencyBits(set, bits, words[k], changed, touched)),
      );
      touched.set(settled.nodes);
      upload(nodes, packed.nodes, 0, DAG_NODE_FLOATS, settled.nodes.length);
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
