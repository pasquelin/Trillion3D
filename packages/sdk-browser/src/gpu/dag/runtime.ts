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
import { MASK_SECTION, flagLocation } from './split.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

export function createDagRuntime(resources: DagResources): GpuSelection {
  const { device, packed, residentCut, pageCount, nodeCount, frameData, buffers, frames } =
    resources;
  // The draw mask, in the part of `flags` that holds its section whole (`split.ts`): its readers
  // bind one buffer at one offset, whatever the split.
  const mask = flagLocation(resources.split.flagCuts, MASK_SECTION, nodeCount, pageCount);
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
    grow: 0,
    growing: false,
    listFull: false,
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
  const poolList = residentCut ? createDagPoolList(device, packed, resources.coldParts) : undefined;
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
    maskBuffer: resources.flagParts[mask.part],
    maskOffset: mask.word,
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
      frames.writeWorlds(next);
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
    updateResidency(next, changes, moved) {
      if (state.disposed || state.dead || !uploadResidency) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      if (!uploadResidency(next, changes, moved)) return false;
      voidCuts();
      return true;
    },
    isFinest: (page) => !uploadResidency || uploadResidency.isFinest(page),
    notePool(page, held) {
      if (state.disposed || state.dead || !poolList?.note(page, held)) return;
      recut();
    },
    // The root and mark words parked or marked since the last cut go up as one interval (CPU-15).
    dispatch(next, shared) {
      if (!state.disposed && !state.dead) frames.flushWords();
      return dispatch(next, shared);
    },
    peek() {
      return state.dead ? null : state.last;
    },
    failed() {
      return state.dead;
    },
    async flush() {
      await state.pending;
      // A cut past its list grows it (`listCap.ts`): the drain grows it, then cuts again on it,
      // rather than hand back the cut before.
      for (const asked = state.lastSubmitted; asked && state.grow && !state.dead;) {
        selection.dispatch(asked);
        await state.pending;
        selection.dispatch(asked);
        await state.pending;
      }
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
