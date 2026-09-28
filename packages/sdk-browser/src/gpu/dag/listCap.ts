import { storageBufferCap } from '../../residency/pools.ts';
import {
  DAG_READBACK_SLOTS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  listCapHeld,
  residentReadbackBytes,
  selectionListCap,
  stagedOutputBytes,
} from './layout.ts';
import type { createDagResources } from './resources.ts';

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
  const output = own({
    label: 'Trillion3D DAG readback',
    size: stagedOutputBytes(listCap),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
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
 * The kernels read the cap from the uniforms (`uniforms.ts`); the pool's list, in `pageCones`,
 * keeps its own (`layout.ts`). A light cut already made keeps the readout it was made with.
 */
export function growDagList(resources: DagResources, listCap: number) {
  const old = [resources.output, ...resources.readback],
    list = createDagList(resources.own, listCap, resources.residentCut);
  Object.assign(resources, list);
  resources.group.out = list.output;
  resources.ranges = resources.frames.bindGroups(resources.layout, resources.group);
  for (const buffer of old) {
    resources.buffers.splice(resources.buffers.indexOf(buffer), 1);
    buffer.destroy();
  }
}
