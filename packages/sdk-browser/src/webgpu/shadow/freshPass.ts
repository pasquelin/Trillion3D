import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { DRAW_INDIRECT_STRIDE } from '../../gpu/draw/draw.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { SHADOW_REGION_INDIRECT_BYTES } from '../../gpu/shadow/batchBudget.ts';
import type { ShadowCullSource } from '../../gpu/shadow/cull.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { FRESH_ARG_WORDS, FRESH_SLICE_FLOATS } from './freshWgsl.ts';
import { shadowRegionGroup } from './regionGroups.ts';

/** Each slice's emitter and far plane, rewritten each frame: a frame allocates nothing. */
const slices = new Float32Array(MAX_SHADOW_SLICES * FRESH_SLICE_FLOATS),
  faceScratch = new Float32Array(16);
/** Every row of the frame, as the region cull reads it (`cull.ts`, no `source`). */
const everyRow = { indirectBase: 0, commands: 0 } as ShadowCullSource;

/** Each lamp's centre, envelope radius and far plane at its slice, as its pages' faces and cones
 *  carry them (`writePage`, `writeFace`); a sun's are zero. */
export function freshSlices(store: SceneLightStore) {
  slices.fill(0);
  for (let slot = 0; slot < store.count; slot++) {
    const slice = store.sliceOf(slot),
      light = slice >= 0 ? store.light(store.ids[slot]) : undefined;
    if (!light || light.kind === 'directional') continue;
    const at = slice * FRESH_SLICE_FLOATS;
    slices.set(light.position!, at);
    slices[at + 3] = light.emitterRadius ?? 0;
    slices[at + 4] = writeFace(faceScratch, 0, null, 0, light, 0).far;
  }
  return slices;
}

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page: one workgroup
 * composes them into regions of the batch buffers (`freshWgsl.ts`); the region cull keeps, for
 * each, every row of the frame its page's light-space volume touches — the camera's rows and the
 * light cuts', the camera's frustum no part of it —, dispatched per layer by the region count the
 * GPU wrote; then each layer's pass clears the pages' squares (`pageQuads.ts`) and draws every
 * region by its own commands, its casters placed on its page in the vertex stage and kept to it
 * by the fragment (`shadow_fresh_vs`, `shadow_fresh_fs`): no indirect draw sets a viewport or a
 * scissor. A page is drawn whole, all its casters at once; the host draws it again, with its light
 * cut and static layer, once a report tells it the page (`mirror.ts`). Its word is readable from
 * this frame on.
 *
 * Each layer's cull takes one of the last uniform slots, which no batch's faces reach
 * (`MAX_SHADOW_PAGES` a batch). Nothing without the GPU allocation, the cull or the page quads,
 * and nothing while a tinted layer is read: a page there holds its blended casters too, which the
 * host alone draws (`encodeTransmittance`), and the page waits for it.
 */
export function encodeFreshPages(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { lights, layout } = rt,
    { allocation, pageRequests, shadows, plan, cull, pageQuads, spheres, mobilityRows } = lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers?.seeded || !plan.gpu.on || !shadows?.texture) return;
  if (!cull || !pageQuads || !spheres || !mobilityRows || shadows.transmittance) return;
  if (!shadowRegionGroup(rt, device, 0)) return;
  const { side, layers } = plan.pool,
    perLayer = Math.floor(MAX_SHADOW_REGIONS / layers),
    rows = layout.rows.packedCount;
  buffers.writeFresh(side, layers, perLayer, rows, freshSlices(lights.store));
  const bound = [shadows.dataBuffer, buffers.state, buffers.drawList, shadows.faceUniform];
  bound.push(cull.faceVolumes, cull.indirect, buffers.freshParams, buffers.freshArgs);
  allocation.fresh(encoder, bound, 1);
  everyRow.spheres = everyRow.indirect = spheres.buffer;
  everyRow.mobility = mobilityRows;
  everyRow.source = undefined;
  everyRow.base = rows;
  for (let layer = 0; layer < layers; layer++) {
    const args = [buffers.freshArgs, layer * FRESH_ARG_WORDS * 4] as const;
    cull.encode(
      encoder,
      everyRow,
      MAX_SHADOW_REGIONS - 1 - layer,
      layer * perLayer,
      perLayer,
      rows,
      args,
    );
  }
  for (let layer = 0; layer < layers; layer++) drawLayer(rt, device, encoder, layer, perLayer);
}

/** Layer `layer`'s pass: its regions' pages cleared to far, then their casters, both lists. */
function drawLayer(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  layer: number,
  perLayer: number,
) {
  const { lights, run } = rt,
    shadows = lights.shadows!,
    draws = shadows.depthDraws(),
    first = layer * perLayer;
  const pass = encoder.beginRenderPass(shadows.passes[layer]);
  let drawn = lights.pageQuads!.encode(pass, first, perLayer, 0);
  const lists = lights.mobility.hasCutouts ? 2 : 1;
  for (let list = 0; list < lists; list++) {
    pass.setPipeline(list ? draws.freshCutout : draws.freshOpaque);
    for (let region = first; region < first + perLayer; region++) {
      pass.setBindGroup(0, shadowRegionGroup(rt, device, region)!);
      pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
      const at = region * SHADOW_REGION_INDIRECT_BYTES + list * DRAW_INDIRECT_STRIDE;
      pass.drawIndirect(lights.cull!.indirect, at);
      drawn++;
    }
  }
  pass.end();
  lights.shadowRenderPasses++;
  lights.shadowDrawCalls += drawn;
  run.gpuDrawCalls += drawn;
}
