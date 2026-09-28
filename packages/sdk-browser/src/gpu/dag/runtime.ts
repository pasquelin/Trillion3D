import {
  SELECTION_NONE as NONE,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from '../core/selection.ts';
import { refreshWorldStretch, worldsChanged } from './worlds.ts';
import { createDagResidencyUpload } from './residencyUpload.ts';
import { createDagPoolList } from './poolList.ts';
import { createDagDispatch } from './dispatch.ts';
import { DAG_READBACK_SLOTS } from './layout.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

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
    mapped: new Array<boolean>(DAG_READBACK_SLOTS).fill(false),
    slot: 0,
  };
  /** Cuts in hand and in flight name pages the kernel may no longer choose: they are void. */
  const voidCuts = () => {
    state.residencyRevision++;
    state.last = null;
  };
  // A dead selection dispatches and drains nothing more.
  const fail = () => ((state.dead = true), voidCuts());
  const previousWorlds = packed.worlds.slice();
  // The cut rule's residency, derived from the pool's and uploaded by difference.
  const uploadResidency = residentCut ? createDagResidencyUpload(resources) : undefined;
  const dispatch = createDagDispatch(resources, state, fail);
  const poolList = residentCut ? createDagPoolList(device, packed, resources.pageCones) : undefined;
  /** The next dispatch cuts and reads back again, the eviction queue with it: the cut in hand stays. */
  const recut = () => (state.submittedResidencyRevision = state.readbackResidencyRevision = -1);
  /** Writes word `slot` of primitive `w`'s frame words, one word up. The cut in hand holds pages
   *  the new word no longer lets through, or lacks some it does: another cut from here. */
  const writeFrameWord = (w: number, slot: number, value: number) => {
    frames.writeWord(w, slot, value);
    resources.frameWrites.count++;
    voidCuts();
  };
  const selection: GpuSelection = {
    residentCut,
    get hostBytes() {
      return (uploadResidency?.hostBytes ?? 0) + (poolList?.entries.byteLength ?? 0);
    },
    maskBuffer: flags,
    maskOffset: nodeCount,
    pageCount,
    get worldRevision() {
      return state.worldRevision;
    },
    updateWorlds(next, posesMoved = true, translationsOnly = false) {
      if (state.disposed || state.dead) return false;
      if (next.byteLength !== packed.worlds.byteLength)
        throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED');
      if (!worldsChanged(previousWorlds, next)) return false;
      // Stretch reads the linear part alone, which a moving origin leaves: read before the copy.
      // Only translations rewritten, the scan could find no linear part that moved: skipped.
      const stretched = translationsOnly
        ? 0
        : refreshWorldStretch(previousWorlds, next, packed, frameData);
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
        frames.writeRows();
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
      // The root travels behind the stretch in the frame buffer (`resources.ts`).
      writeFrameWord(w, 1, node);
    },
    markWorld(w, mark) {
      if (state.disposed || state.dead || packed.mark[w] === mark) return;
      packed.mark[w] = mark;
      // The mark travels behind the record shift (`primitiveFrameWords`).
      writeFrameWord(w, 3, mark);
    },
    updateResidency(next, changes) {
      if (state.disposed || state.dead || !uploadResidency) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      if (!uploadResidency(next, changes)) return false;
      voidCuts();
      return true;
    },
    notePool(page, held) {
      if (state.disposed || state.dead || !poolList?.note(page, held)) return;
      recut();
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
