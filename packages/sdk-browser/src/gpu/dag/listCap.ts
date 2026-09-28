import { storageBufferCap } from '../../residency/pools.ts';
import { validationScope } from '../core/errorScope.ts';
import {
  DAG_READBACK_SLOTS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  listCapHeld,
  residentReadbackBytes,
  selectionListCap,
} from './layout.ts';
import { makeDagBuffer, readoutRow } from './bufferTable.ts';
import type { createDagResources } from './resources.ts';
import type { DagRuntimeState } from './dispatch.ts';

export type Limits = Parameters<typeof storageBufferCap>[0];
type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/** The most ranks one `out` binding holds on this device. */
export const deviceListCap = (limits: Limits) => listCapHeld(storageBufferCap(limits));

/** The cap a cut starts with: the readout's (`selectionListCap`, `layout.ts`), within the device. */
export const initialListCap = (limits: Limits, pageCount: number) =>
  Math.min(selectionListCap(pageCount), deviceListCap(limits));

/**
 * THE CAP A TRUNCATED READOUT GROWS TO. The list was sized for a wide cut, not for every cut: a
 * view that keeps more asks `needed` ranks, and the list doubles past it — the view ahead may take
 * half of it (`shader/snapshotWgsl.ts`) — within the catalogue and what one binding holds.
 * `undefined` when even that cannot hold the cut: the readout stays truncated and the host falls
 * back to the CPU cut, saying so.
 */
export function grownListCap(limits: Limits, pageCount: number, cap: number, needed: number) {
  const next = Math.min(pageCount, deviceListCap(limits), 2 * Math.max(cap, needed));
  return next > cap && next >= Math.min(needed, pageCount) ? next : undefined;
}

/** Ranks the cut asked of its readout, kept or not: the requests' counter, and the drawn list's
 *  behind them, both counted past the cap (`shader/snapshotWgsl.ts`, `shader/compactWgsl.ts`). */
export function listDemand(bytes: ArrayBuffer, drawnWordOffset: number) {
  const ints = new Uint32Array(bytes, 0, drawnWordOffset + 1);
  return Math.max(ints[OUT_COUNT], drawnWordOffset ? ints[drawnWordOffset] : 0);
}

/** The readout of a cut whose list holds `listCap` ranks: the buffer the kernels write, and the
 *  readback slots the frame copies it into, each made by `own` (`resources.ts`). */
export function createDagList(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  listCap: number,
  residentCut: boolean,
) {
  const outputBytes = (HEAD + listCap) * 4,
    // A resident cut adds its drawn list and one burst of its eviction queue (`EVICTION_BURST`).
    readbackBytes = residentCut ? residentReadbackBytes(listCap) : outputBytes;
  // Behind the eviction queue, the requests wait for their sort, outside what the frame copies
  // (`shader/snapshotWgsl.ts`).
  const output = makeDagBuffer(own, readoutRow(listCap));
  const readback = Array.from({ length: DAG_READBACK_SLOTS }, () =>
    own({
      size: readbackBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  );
  return { listCap, outputBytes, readbackBytes, output, readback };
}

/**
 * Gives the camera cut a list of `listCap` ranks, between two frames and with no readback in
 * flight: a new readout and its slots, the bind groups that name it, and the old ones destroyed.
 * Made under an out-of-memory scope: a device that cannot grant the larger list keeps the old one
 * whole and says `false`, so the host falls back on the next truncated readout rather than on an
 * error of the whole device. The kernels read the cap from the uniforms (`uniforms.ts`); the pool's
 * list, in `pageCones`, keeps its own (`layout.ts`). A light cut already made keeps the readout it
 * was made with.
 */
async function growDagList(resources: DagResources, listCap: number, disposed: () => boolean) {
  const made: GPUBuffer[] = [];
  const make = (descriptor: GPUBufferDescriptor) => {
    const buffer = resources.device.createBuffer(descriptor);
    made.push(buffer);
    return buffer;
  };
  let list: ReturnType<typeof createDagList> | undefined;
  try {
    const { value, error } = await validationScope(
      resources.device,
      () => createDagList(make, listCap, resources.residentCut),
      'out-of-memory',
    );
    if (!error) list = value;
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (!list || disposed()) {
    for (const buffer of made) buffer.destroy();
    return false;
  }
  const old = [resources.output, ...resources.readback];
  Object.assign(resources, list);
  resources.buffers.push(...made);
  resources.group.out = list.output;
  resources.ranges = resources.frames.bindGroups(resources.layout, resources.group);
  for (const buffer of old) {
    resources.buffers.splice(resources.buffers.indexOf(buffer), 1);
    buffer.destroy();
  }
  return true;
}

/** Grows the list to `state.grow` behind the readbacks in `state.pending`; no frame cuts until it
 *  is in place or refused, and the next one cuts and reads again — on the grown list, or, refused,
 *  to hand the truncated readout to the host. */
export function queueDagListGrowth(resources: DagResources, state: DagRuntimeState) {
  const wanted = state.grow;
  state.grow = 0;
  state.growing = true;
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        if (!(await growDagList(resources, wanted, () => state.disposed))) state.listFull = true;
      } finally {
        state.growing = false;
        state.submittedResidencyRevision = state.readbackResidencyRevision = -1;
      }
    });
}
