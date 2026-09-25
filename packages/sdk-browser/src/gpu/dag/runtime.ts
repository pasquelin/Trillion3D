import {
  SELECTION_NONE as NONE,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from '../core/selection.ts';
import { primitiveWordAt, refreshWorldStretch, worldsChanged } from './worlds.ts';
import { createDagResidencyUpload } from './residencyUpload.ts';
import { createDagDispatch } from './dispatch.ts';
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
  // The cut rule's residency, derived from the pool's and uploaded by difference.
  const uploadResidency = residentCut ? createDagResidencyUpload(resources) : undefined;
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
      if (state.disposed || state.dead || !uploadResidency) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      if (!uploadResidency(next, changes)) return false;
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
