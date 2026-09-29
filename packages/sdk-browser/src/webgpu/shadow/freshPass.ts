import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_CASTERS, FRESH_CLEAR, FRESH_SLICE_FLOATS, freshDrawWord } from './freshLayout.ts';
import { freshGroups } from './freshGroups.ts';
import { shadowRegionGroup } from './regionGroups.ts';

/** Each slice's emitter and far plane, rewritten each frame: a frame allocates nothing. */
const slices = new Float32Array(MAX_SHADOW_SLICES * FRESH_SLICE_FLOATS),
  faceScratch = new Float32Array(16),
  blend: [number, number] = [0, 0];
/** Bytes of a kept pair: its region, its row. */
const PAIR_BYTES = 8;

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
 * Whether this frame may hand the GPU a page to draw: a frame where nothing moves — neither the
 * view nor a node (`plan.quiet`), nor a light (`plan.stamp`) —, whose host took no page's depth
 * (`allocation.lost`), after a snapshot whose frame listed nothing (`gpu.listed`), maps nothing
 * new and leaves nothing undrawn, and runs none of the GPU's page work. Any other runs it.
 */
function freshWanted(rt: WebgpuPagesRuntime) {
  const { plan, store, pageRequests } = rt.lights,
    stamp = plan.stamp(store),
    held = freshStamps.get(plan);
  freshStamps.set(plan, stamp);
  if (!plan.quiet || held !== stamp || plan.gpu.listed > 0) return true;
  return (pageRequests?.allocation.lost ?? 0) > 0;
}
const freshStamps = new WeakMap<object, number>();

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page — every one of them,
 * whatever their number. One workgroup composes them into regions (`freshWgsl.ts`); the pair cull
 * keeps, for each, every caster row its page's light-space volume touches (`freshCullWgsl.ts`) —
 * the table's rows are every resident page of every caster, the camera no part of it —; the seal
 * makes readable each page none of whose casters was lost; then each pool layer's pass clears its
 * pages' squares and draws every kept pair, in two indirect draws (`freshDrawsWgsl.ts`), and,
 * while a tinted layer is read, that layer's pass the same with the blended casters: no indirect
 * draw sets a viewport. The host draws a page again, with its light cut and static layer, once a
 * report tells it the page (`mirror.ts`).
 *
 * Nothing without the GPU allocation, the cull's rows or the draws, and nothing in a frame that
 * has nothing new to draw (`freshWanted`): a frame at rest runs none of it.
 */
export function encodeFreshPages(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { lights, layout, run } = rt,
    { allocation, pageRequests, shadows, plan, cull, spheres, mobilityRows } = lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers?.seeded || !plan.gpu.on || !shadows?.texture) return;
  if (!cull || !spheres || !mobilityRows || !freshWanted(rt)) return;
  const region = shadowRegionGroup(rt, device, 0);
  if (!region) return;
  const { side, layers } = plan.pool,
    { rows } = layout,
    tint = shadows.transmittance;
  blend[0] = rows.blendFirst;
  blend[1] = rows.casterSlots;
  const capacity = Math.floor(cull.kept.size / PAIR_BYTES);
  buffers.writeFresh(side, layers, rows.packedCount, blend, capacity, freshSlices(lights.store));
  const composed = [shadows.dataBuffer, buffers.state, buffers.drawList, buffers.freshFaces];
  composed.push(buffers.freshVolumes, buffers.freshArgs, buffers.freshParams);
  allocation.compose(encoder, composed, 1);
  const culled = [spheres.buffer, buffers.freshParams, buffers.freshVolumes, cull.kept];
  culled.push(buffers.freshArgs, mobilityRows);
  allocation.cull(encoder, culled, [buffers.freshArgs, 0]);
  allocation.seal(encoder, composed, 1);
  const groups = freshGroups(device, shadows, buffers, cull.kept),
    draws = shadows.freshDraws.made();
  for (let layer = 0; layer < layers; layer++) {
    const passes = tint ? [shadows.passes[layer], tint.passes[layer]] : [shadows.passes[layer]];
    passes.forEach((descriptor, tinted) => {
      const pass = encoder.beginRenderPass(descriptor);
      pass.setBindGroup(0, region);
      pass.setBindGroup(1, shadows.faceGroup, [0]);
      pass.setBindGroup(2, tinted ? groups.tint[layer] : groups.pool);
      const kinds = tinted
        ? [draws.tintClear, draws.tintDepth, draws.tintColour]
        : [draws.clear, draws.casters];
      kinds.forEach((pipeline, k) => {
        pass.setPipeline(pipeline);
        pass.drawIndirect(
          buffers.freshArgs,
          4 * freshDrawWord(layer, k ? FRESH_CASTERS : FRESH_CLEAR),
        );
      });
      pass.end();
      lights.shadowRenderPasses++;
      lights.shadowDrawCalls += kinds.length;
      run.gpuDrawCalls += kinds.length;
    });
  }
}
