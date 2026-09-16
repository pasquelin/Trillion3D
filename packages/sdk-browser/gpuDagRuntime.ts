import { maxStretch } from '../sdk-core/index.ts';
import {
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type ResidencyChanges,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { RESIDENCY_RANGE_MAX, coalesceResidencyRanges } from './webgpuResidencyRanges.ts';
import { FRAME_VEC4 } from './gpuDagTypes.ts';
import { residentBase, residentWords } from './gpuDagLayout.ts';
import { createDagDispatch } from './gpuDagDispatch.ts';
import type { createDagResources } from './gpuDagResources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * La résidence demandée, posée en bits : un mot pour trente-deux grappes, qui est à lui seul son
 * propre miroir — la comparaison relit le bit qu'elle s'apprête à écrire, sans tableau parallèle.
 * Seules les pages que le journal des rangs nomme sont visitées, toutes quand il n'en nomme aucune
 * de façon fiable. `touched` reçoit les rangs de mot touchés, croissants et sans répétition : ce sont
 * eux que le dessus écrit, non les pages. Rend leur nombre.
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
  // Les bits de résidence prolongent les enregistrements froids, dans le même tampon : la même vue
  // sert de miroir à la comparaison et de source à l'écriture, sans tableau parallèle.
  const residentWord = residentBase(pageCount),
    bits = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    );
  /** Les mots que la dernière application a réellement changés, et les plages qui les couvrent. */
  const touched = new Int32Array(Math.max(1, residentWords(pageCount)));
  const ranges = new Int32Array(RESIDENCY_RANGE_MAX * 2);
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
      const count = updateResidencyBits(next, bits, residentWord, changes, touched);
      if (!count) return false;
      // Une écriture par plage contiguë de mots, jamais une par page : ce qui part vers la carte
      // n'est plus qu'un bit par grappe, et mille petites écritures ne valent pas la seule qu'elles
      // remplacent.
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
