import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_CASTERS, FRESH_CLEAR, FRESH_SLICE_FLOATS, freshDrawWord } from './freshLayout.ts';
import { freshGroups } from './freshGroups.ts';

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
 * Whether this frame may hand the GPU a page to draw: the view or anything in the world moved — a
 * caster's own surface asks new pages as it moves — (`gpu.moved`), a light was added, set or
 * removed (light `epoch`), the host took `lost` pages' depth away (`allocation.lost`), or the
 * latest snapshot's frame listed pages (`gpu.listed`) — a frame at rest runs while it does
 * (`shadowsUnsettled`). Otherwise the frame asks for the pages the last one did, which are drawn,
 * and runs none of the GPU's page work.
 */
export function freshWanted(plan: ShadowPlan, epoch: number, lost: number) {
  const held = epochs.get(plan);
  epochs.set(plan, epoch);
  return plan.gpu.moved || held !== epoch || plan.gpu.listed > 0 || lost > 0;
}
const epochs = new WeakMap<object, number>();

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page — every one, a page
 * whose pairs the list could not hold all of the next frame (#1363). One workgroup composes them
 * into regions (`freshWgsl.ts`); the pair cull keeps, for each, every caster row its page's
 * light-space volume touches (`freshCullWgsl.ts`) — the table's rows are every resident page of
 * every caster, the camera no part of it —; the seal makes readable each page that kept all its
 * pairs; then each pool layer's pass clears its
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
  if (!cull || !spheres || !mobilityRows) return;
  if (!freshWanted(plan, lights.store.epoch, buffers.lost)) return;
  const groups = freshGroups(rt, device);
  if (!groups) return;
  const { side, layers } = plan.pool,
    { rows } = layout,
    tint = shadows.transmittance;
  blend[0] = rows.blendFirst;
  blend[1] = rows.casterSlots;
  const capacity = Math.floor(cull.kept.size / PAIR_BYTES);
  buffers.writeFresh(side, layers, rows.packedCount, blend, capacity, freshSlices(lights.store));
  const composed = [shadows.dataBuffer, buffers.state, buffers.drawList, buffers.freshFaces];
  composed.push(
    buffers.freshVolumes,
    buffers.freshArgs,
    buffers.freshParams,
    buffers.freshDispatch,
  );
  allocation.compose(encoder, composed, 1);
  const culled = [spheres.buffer, buffers.freshParams, buffers.freshVolumes, cull.kept];
  culled.push(buffers.freshArgs, mobilityRows);
  allocation.cull(encoder, culled, [buffers.freshDispatch, 0]);
  allocation.seal(encoder, composed, 1);
  const draws = shadows.freshDraws.made();
  for (let layer = 0; layer < layers; layer++)
    for (let tinted = 0; tinted <= (tint ? 1 : 0); tinted++) {
      // The layer's own descriptors (`layerPasses`): labelled for the GPU timing (#685).
      const passes = tint && tinted ? tint.passes : shadows.passes;
      const pass = encoder.beginRenderPass(passes[layer]);
      pass.setBindGroup(0, groups.page);
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
    }
}
