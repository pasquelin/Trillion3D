import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_CASTERS, FRESH_CLEAR, freshDrawWord } from './freshLayout.ts';
import { freshSlices, freshWanted } from './freshInputs.ts';
import { freshGroups } from './freshGroups.ts';
import { growPairList } from './pairGrowth.ts';
import { keptPairs } from './pairRows.ts';

/** The blended casters' rows, rewritten each frame: a frame allocates nothing. */
const blend: [number, number] = [0, 0];

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page — every one, a page
 * whose pairs the kept list could not hold the next frame, the list grown to them (#1363). One
 * workgroup composes them into regions (`freshWgsl.ts`); the pair cull counts, admits whole and
 * keeps, for each, every caster row its page's light-space volume touches (`freshCullWgsl.ts`) —
 * the table's rows are every resident page of every caster, the camera no part of it — in the
 * region cull's kept list, grown to the frames' need (`pairGrowth.ts`); the seal makes readable
 * each page admitted; then each pool layer's pass clears its pages' squares and draws every kept
 * pair, in two indirect draws (`freshDrawsWgsl.ts`), and, while a tinted layer is read, that
 * layer's pass the same with the blended casters: no indirect draw sets a viewport. The host draws
 * a page again, with its light cut and static layer, once a report tells it the page (`mirror.ts`).
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
  growPairList(rt);
  const pairs = cull.kept,
    groups = freshGroups(rt, device, pairs);
  if (!groups) return;
  const { side, layers } = plan.pool,
    { rows } = layout,
    tint = shadows.transmittance;
  blend[0] = rows.blendFirst;
  blend[1] = rows.casterSlots;
  const capacity = keptPairs(cull.capacity);
  buffers.writeFresh(side, layers, rows.packedCount, blend, capacity, freshSlices(lights.store));
  const composed = [shadows.dataBuffer, buffers.state, buffers.drawList, buffers.freshFaces];
  composed.push(
    buffers.freshVolumes,
    buffers.freshArgs,
    buffers.freshParams,
    buffers.freshDispatch,
  );
  allocation.compose(encoder, composed, 1);
  const culled = [spheres.buffer, buffers.freshParams, buffers.freshVolumes, pairs];
  culled.push(buffers.freshArgs, mobilityRows);
  allocation.count(encoder, culled, [buffers.freshDispatch, 0]);
  allocation.admit(encoder, culled, 1);
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
  plan.gpu.drew(run.frame);
}
