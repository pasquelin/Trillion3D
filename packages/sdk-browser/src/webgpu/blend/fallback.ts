import { viewProj } from '../pages/helpers.ts';
import { UNIFORM_STRIDE } from './uniforms.ts';
import { voidStaleBlendGroups } from './identity.ts';
import { refreshSurface } from '../../page/surface.ts';
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts';
import { drawnBlending } from '../../scene/materialBlending.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { createWebgpuBlendState } from './state.ts';

/** Words of one fallback draw: the visible item, its first index word, its index count. */
const DRAW_WORDS = 3;

/**
 * The fallback pass's draws of the image into `blendState.fallbackDraws`; returns how many. An
 * unpaged item draws its own indices once. The fallback shader reads no instance, so a paged item
 * draws each cluster its cut kept, in table order, from the span its page holds in the cache —
 * drawn whole through the compaction's arguments, it drew nothing (#584). A cluster not resident
 * has an empty span and draws nothing, as in the blend pass.
 */
export function listFallbackBlendDraws(blendState: ReturnType<typeof createWebgpuBlendState>) {
  const { visibleBlend: items, table, cpuInstances, cpuItemCounts } = blendState;
  let count = 0;
  const push = (item: number, first: number, indices: number) => {
    if ((count + 1) * DRAW_WORDS > blendState.fallbackDraws.length) {
      const grown = new Uint32Array(Math.max(16, count * 2) * DRAW_WORDS);
      grown.set(blendState.fallbackDraws);
      blendState.fallbackDraws = grown;
    }
    blendState.fallbackDraws.set([item, first, indices], count++ * DRAW_WORDS);
  };
  for (let i = 0; i < items.length; i++) {
    const { paged, pagedIndex, count: indices } = items[i];
    if (!paged || !table || pagedIndex === undefined) {
      push(i, 0, indices);
      continue;
    }
    const base = table.itemRanges[pagedIndex * 2];
    for (let k = base; k < base + cpuItemCounts[pagedIndex]; k++) {
      const entry = cpuInstances[k];
      if (table.spans[entry * 2 + 1]) push(i, table.spans[entry * 2], table.spans[entry * 2 + 1]);
    }
  }
  return count;
}

/**
 * The transparent fallback path: the one for devices where the visibility buffer could not be
 * set up. It keeps the generic shader, its per-draw uniform and its CPU selection — it is not
 * the path of production frames, and nothing in it has been optimised. Writes one uniform per
 * draw `listFallbackBlendDraws` listed, from `uniformBase` on.
 */
export function writeFallbackBlendUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  uniformBase: number,
  draws: number,
) {
  const { run, blendState } = rt,
    items = blendState.visibleBlend,
    list = blendState.fallbackDraws,
    { uniformPacked } = rt.gpu,
    uniformBuffer = rt.gpu.uniformBuffer!;
  const words = UNIFORM_STRIDE / 4;
  const packedInts = new Uint32Array(
    uniformPacked.buffer,
    uniformPacked.byteOffset,
    uniformPacked.length,
  );
  for (let d = 0; d < draws; d++) {
    const item = items[list[d * DRAW_WORDS]],
      base = (uniformBase + d) * words;
    const surface = refreshSurface(item.surface);
    // This path reads float positions and no direction: a line quad could not be widened
    // (`lineClip`), and is refused by name rather than dropped.
    if ((surface.lineWidth ?? 0) > 0) throw new Error('FALLBACK_TRANSPARENT_LINES_UNSUPPORTED');
    uniformPacked.set(viewProj, base);
    uniformPacked.set(item.matrix.elements, base + 16);
    uniformPacked[base + 32] = item.rgba[0];
    uniformPacked[base + 33] = item.rgba[1];
    uniformPacked[base + 34] = item.rgba[2];
    uniformPacked[base + 35] = item.rgba[3];
    packedInts[base + 36] = list[d * DRAW_WORDS + 1];
    packedInts[base + 37] = list[d * DRAW_WORDS + 2];
    packedInts[base + 38] = run.diagnostic === 'wireframe' ? 1 : 0;
    packedInts[base + 39] = item.flags;
    // No width and no dash: the words a line page of the opaque draw may have left here.
    uniformPacked[base + 40] = 0;
    uniformPacked[base + 44] = 0;
    // A sprite turns to face the camera like in every raster (`spriteAt`).
    writeSpriteWords(uniformPacked, base + 46, surface.sprite);
  }
  device.queue.writeBuffer(
    uniformBuffer,
    uniformBase * UNIFORM_STRIDE,
    uniformPacked.subarray(uniformBase * words, (uniformBase + draws) * words),
  );
}

/** Encodes the fallback pass: one bind group per item and one dynamic offset per draw, and the
 *  pipeline of its blending mode, set when it changes. */
export function drawFallbackBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  draws: number,
) {
  const { gpu, run, blendState } = rt,
    items = blendState.visibleBlend,
    list = blendState.fallbackDraws;
  let unpaged = 0;
  voidStaleBlendGroups(rt);
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D transparents',
    colorAttachments: [{ view: gpu.colorView!, loadOp: 'load', storeOp: 'store' }],
    depthStencilAttachment: { view: gpu.depthView!, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  let bound: GPURenderPipeline | undefined;
  for (let d = 0; d < draws; d++) {
    const item = items[list[d * DRAW_WORDS]],
      indices = list[d * DRAW_WORDS + 2];
    // Each item in its own mode, the one table's equation: a mode no path draws is refused by name.
    const mode = drawnBlending(refreshSurface(item.surface).blending, !!item.transmissive);
    const pipeline = gpu.pipelineBlend!.at(mode);
    if (pipeline !== bound) pass.setPipeline((bound = pipeline));
    item.group ??= device.createBindGroup({
      layout: gpu.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: item.index ?? gpu.cache!.buffer } },
        { binding: 1, resource: { buffer: item.position } },
        { binding: 2, resource: { buffer: gpu.uniformBuffer!, size: UNIFORM_STRIDE } },
      ],
    });
    pass.setBindGroup(0, item.group, [(uniformBase + d) * UNIFORM_STRIDE]);
    pass.draw(indices);
    // A paged item's triangles are the cut's, counted with it.
    if (!item.paged) unpaged += indices / 3;
  }
  pass.end();
  run.gpuDrawCalls += draws;
  run.blendDrawCalls += draws;
  run.blendUnpagedTriangles += unpaged;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
