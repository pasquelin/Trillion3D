import { visBindEntries } from '../core/bindEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_UNREAD } from './freshDraws.ts';

type FreshGroups = { key: unknown[]; page: GPUBindGroup; pool: GPUBindGroup; tint: GPUBindGroup[] };
const held = new WeakMap<GPUDevice, FreshGroups>();
/** Each device's page rows group, and the resources it was made on, compared in place. */
const rowGroups = new WeakMap<GPUDevice, { key: unknown[]; group: GPUBindGroup }>();

/**
 * Group 0 of the draws that place their casters themselves — the GPU's pages, the moving groups
 * (`movingGroups.ts`): the page table's rows as the region draws bind them (`regionGroups.ts`), but
 * for what these draws never read. Made again only when one of its resources changed identity,
 * nothing allocated otherwise; undefined while one is missing.
 */
export function shadowPageGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, gpu, lights } = rt,
    { shadows, cull } = lights,
    cache = gpu.cache?.buffer,
    { concatPos, concatUv, pageTable, textures, mapsSampler } = vis;
  if (!shadows || !cull || !cache || !concatPos || !concatUv || !pageTable) return;
  if (!textures || !mapsSampler) return;
  const made = rowGroups.get(device),
    key = made?.key;
  if (
    key &&
    key[0] === cache &&
    key[1] === concatPos &&
    key[2] === concatUv &&
    key[3] === pageTable &&
    key[4] === textures.color.views &&
    key[5] === cull.drawUniform &&
    key[6] === shadows.freshDraws.pageLayout
  )
    return made.group;
  const entries = visBindEntries({
    ...{ cache, position: concatPos, pageTable, flags: cache, uniform: cull.drawUniform },
    ...{ uniformOffset: 0, uv: concatUv, textures, sampler: mapsSampler },
    ...{ instances: cull.kept, slotOffsets: cull.kept },
  }).filter(({ binding }) => !FRESH_UNREAD.has(binding));
  const layout = shadows.freshDraws.pageLayout,
    group = device.createBindGroup({ layout, entries });
  const views = textures.color.views;
  rowGroups.set(device, {
    key: [cache, concatPos, concatUv, pageTable, views, cull.drawUniform, layout],
    group,
  });
  return group;
}

/**
 * The groups of the draws of the pages the GPU draws itself (`freshDraws.ts`): group 0, the page
 * rows (`shadowPageGroup`); group 2 into the pool — their views, the kept pairs (the region cull's
 * list, free once the host's batches are encoded) and the arguments —, and into each layer of the
 * transmittance layer the same after the pool's opaque depth of that layer. Made again only when
 * one of them changed identity; undefined while a resource is missing.
 */
export function freshGroups(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { shadows, cull, pageRequests } = rt.lights,
    buffers = pageRequests?.allocation,
    page = shadowPageGroup(rt, device);
  if (!shadows || !cull || !buffers || !page) return;
  const pairs = cull.kept,
    key = [page, pairs, shadows.targets, buffers.freshFaces, buffers.freshArgs];
  const cached = held.get(device);
  if (cached && cached.key.every((part, k) => part === key[k])) return cached;
  const { poolLayout, tintLayout } = shadows.freshDraws;
  const entries = [buffers.freshFaces, pairs, buffers.freshArgs].map((buffer, k) => ({
    binding: k + 1,
    resource: { buffer },
  }));
  const made: FreshGroups = {
    key,
    page,
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
