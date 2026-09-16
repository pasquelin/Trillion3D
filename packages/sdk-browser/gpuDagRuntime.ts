import { maxStretch } from '../sdk-core/index.ts';
import {
  PAGE_CONE_FLOATS,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type ResidencyChanges,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { RESIDENCY_RANGE_MAX, coalesceResidencyRanges } from './webgpuResidencyRanges.ts';
import { FRAME_VEC4 } from './gpuDagTypes.ts';
import { createDagDispatch } from './gpuDagDispatch.ts';
import type { createDagResources } from './gpuDagResources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * La résidence demandée, appliquée aux seules pages que le journal des rangs nomme — celles dont le
 * drapeau vient d'entrer ou de sortir — et à toutes les pages quand il n'en nomme aucune de façon
 * fiable. Le drapeau vit à un flottant sur douze dans les cônes de page. Les index retenus dans
 * `touched` sont croissants ; ils disent au dessus quelles plages écrire. Rend leur nombre.
 */
export function updateResidencyFlags(
  next: Uint32Array,
  mirror: Float32Array,
  pageCones: Float32Array,
  stride: number,
  offset: number,
  changes: ResidencyChanges | undefined,
  touched: Int32Array,
) {
  let count = 0;
  const apply = (j: number) => {
    const value = next[j] ? 1 : 0;
    if (mirror[j] === value) return;
    mirror[j] = value;
    pageCones[j * stride + offset] = value;
    touched[count++] = j;
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
    mapped: [false, false],
    slot: 0,
  };
  const fail = () => {
    state.dead = true;
    state.last = null;
    state.lastSubmitted = undefined;
    state.lastReadback = undefined;
  };
  const previousWorlds = packed.worlds.slice();
  // Miroir compact des drapeaux de résidence : la comparaison d'une image lit ce tableau contigu
  // plutôt que de sauter de douze flottants en douze flottants dans les cônes de page.
  const residence = new Float32Array(pageCount);
  for (let j = 0; j < pageCount; j++) residence[j] = packed.pageCones[j * PAGE_CONE_FLOATS + 11];
  /** Les pages que la dernière application a réellement changées, et les plages qui les couvrent. */
  const touched = new Int32Array(pageCount);
  const ranges = new Int32Array(RESIDENCY_RANGE_MAX * 2);
  const coneBytes = PAGE_CONE_FLOATS * 4;
  const dispatch = createDagDispatch(resources, state, fail);
  const selection: GpuSelection = {
    residentCut,
    maskBuffer: flags,
    maskOffset: nodeCount,
    pageCount,
    updateWorlds(next) {
      if (state.disposed || state.dead) return false;
      if (next.byteLength !== packed.worlds.byteLength)
        throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED');
      let changed = false;
      for (let j = 0; j < next.length; j++)
        if (previousWorlds[j] !== next[j]) {
          changed = true;
          break;
        }
      if (!changed) return false;
      previousWorlds.set(next);
      packed.worlds.set(next);
      device.queue.writeBuffer(
        worlds,
        0,
        next.buffer as ArrayBuffer,
        next.byteOffset,
        next.byteLength,
      );
      // The object-to-view stretch is the primitive's own; recompute it whenever its placement moves.
      for (let w = 0; w < packed.worldCount; w++) {
        packed.worldStretch[w] = maxStretch(packed.worlds.subarray(w * 16, w * 16 + 16));
        frameData[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
      }
      device.queue.writeBuffer(frames, 0, frameData as Float32Array<ArrayBuffer>);
      state.worldRevision++;
      state.last = null;
      state.lastSubmitted = undefined;
      state.lastReadback = undefined;
      return true;
    },
    updateResidency(next, changes) {
      if (state.disposed || state.dead || !residentCut) return false;
      if (next.length !== pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      const count = updateResidencyFlags(
        next,
        residence,
        packed.pageCones,
        PAGE_CONE_FLOATS,
        11,
        changes,
        touched,
      );
      if (!count) return false;
      // Une écriture par plage contiguë, jamais une par page : la totalité des cônes ne repart plus
      // pour un drapeau, et mille petites écritures ne remplacent pas la seule qu'elles coûtent.
      const spans = coalesceResidencyRanges(touched, count, ranges);
      for (let r = 0; r < spans; r++) {
        const from = ranges[r * 2],
          bytes = (ranges[r * 2 + 1] - from + 1) * coneBytes;
        device.queue.writeBuffer(
          pageCones,
          from * coneBytes,
          packed.pageCones.buffer as ArrayBuffer,
          packed.pageCones.byteOffset + from * coneBytes,
          bytes,
        );
      }
      state.residencyRevision++;
      state.last = null;
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
          state.readbackResidencyRevision !== state.residencyRevision)
      ) {
        selection.dispatch(state.lastSubmitted);
        await state.pending;
      }
      return state.dead ? null : (state.last?.result ?? null);
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
