import { visBindEntries } from '../core/bindEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_UNREAD } from './freshDraws.ts';

type FreshGroups = { key: unknown[]; page: GPUBindGroup; pool: GPUBindGroup; tint: GPUBindGroup[] };
const held = new WeakMap<GPUDevice, FreshGroups>();

/**
 * The groups of the draws of the pages the GPU draws itself (`freshDraws.ts`): group 0, the page
 * table's rows as the region draws bind them (`regionGroups.ts`), but for what these draws never
 * read; group 2 into the pool — their views, the kept pairs (the region cull's list, free once the
 * host's batches are encoded) and the arguments —, and into each layer of the transmittance layer
 * the same after the pool's opaque depth of that layer. Made again only when one of them changed
 * identity; undefined while a resource is missing.
 */
export function freshGroups(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, gpu, lights } = rt,
    { shadows, cull, pageRequests } = lights,
    buffers = pageRequests?.allocation,
    cache = gpu.cache?.buffer,
    { concatPos, concatUv, pageTable, textures, mapsSampler } = vis;
  if (!shadows || !cull || !buffers || !cache || !concatPos || !concatUv || !pageTable) return;
  if (!textures || !mapsSampler) return;
  const pairs = cull.kept,
    key = [cache, concatPos, concatUv, pageTable, textures.color.views, pairs, shadows.targets];
  key.push(buffers.freshFaces, buffers.freshArgs, cull.drawUniform);
  const cached = held.get(device);
  if (cached && cached.key.every((part, k) => part === key[k])) return cached;
  const { pageLayout, poolLayout, tintLayout } = shadows.freshDraws;
  const rows = visBindEntries({
    ...{ cache, position: concatPos, pageTable, flags: cache, uniform: cull.drawUniform },
    ...{ uniformOffset: 0, uv: concatUv, textures, sampler: mapsSampler },
    ...{ instances: pairs, slotOffsets: pairs },
  }).filter(({ binding }) => !FRESH_UNREAD.has(binding));
  const entries = [buffers.freshFaces, pairs, buffers.freshArgs].map((buffer, k) => ({
    binding: k + 1,
    resource: { buffer },
  }));
  const made: FreshGroups = {
    key,
    page: device.createBindGroup({ layout: pageLayout, entries: rows }),
    pool: device.createBindGroup({ layout: poolLayout, entries }),
    tint: shadows.targets.map((resource) =>
      device.createBindGroup({
        layout: tintLayout,
        entries: [{ binding: 0, resource }, ...entries],
      }),
    ),
  };
  held.set(device, made);
  return made;
}
