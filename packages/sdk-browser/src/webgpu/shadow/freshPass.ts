import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_CASTERS, FRESH_CLEAR, FRESH_MOVING, FRESH_STILL } from './freshLayout.ts';
import { freshDrawWord } from './freshLayout.ts';
import { freshSlices, freshWanted } from './freshInputs.ts';
import { freshGroups } from './freshGroups.ts';
import { growPairList } from './pairGrowth.ts';
import { keptPairs, poolPairs } from './pairRows.ts';

/** The blended casters' rows, rewritten each frame: a frame allocates nothing. */
const blend: [number, number] = [0, 0];

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page — every one, a page
 * whose pairs the kept list could not hold the next frame or the host's (#1363, #831). One
 * workgroup composes them into regions (`freshWgsl.ts`); the pair cull counts, admits whole and
 * keeps, for each, every caster row its page's light-space volume touches at the level its texels
 * want (`freshCullWgsl.ts`, `rowLods.ts`) — the table's rows are every resident page of every
 * caster, the camera no part of it — in the
 * region cull's kept list, of the pool's fixed pairs (`pairGrowth.ts`); the seal makes readable
 * each page admitted; then each pool layer's pass clears its pages' squares and draws every kept
 * pair, in two indirect draws (`freshDrawsWgsl.ts`), and, while a tinted layer is read, that
 * layer's pass the same with the blended casters: no indirect draw sets a viewport. With a static
 * layer, each layer's pass of it does the same with the still casters alone. The host adopts the
 * page once a report tells it (`mirror.ts`), its static layer with it, and draws it again only
 * when what it holds changes (#831).
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
    { allocation, pageRequests, shadows, plan, cull, spheres, mobilityRows, rowLods } = lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers?.seeded || !plan.gpu.on || !shadows?.texture) return;
  if (!cull || !spheres || !mobilityRows || !rowLods) return;
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
  // The frame's pairs, never more, though the host's caster rows widen the list (`poolPairs`): a
  // region past them waits, whole, for the next frame or the host's draw.
  const capacity = Math.min(keptPairs(cull.capacity), poolPairs(plan.pool.pages));
  const slices = freshSlices(lights.store);
  buffers.writeFresh(
    side,
    layers,
    rows.packedCount,
    blend,
    capacity,
    lights.shadowPixelError,
    slices,
  );
  const composed = [shadows.dataBuffer, buffers.state, buffers.drawList, buffers.freshFaces];
  composed.push(
    buffers.freshVolumes,
    buffers.freshArgs,
    buffers.freshParams,
    buffers.freshDispatch,
  );
  allocation.compose(encoder, composed, 1);
  const culled = [spheres.buffer, buffers.freshParams, buffers.freshVolumes, pairs];
  culled.push(buffers.freshArgs, mobilityRows, rowLods.buffer);
  allocation.count(encoder, culled, [buffers.freshDispatch, 0]);
  allocation.admit(encoder, culled, 1);
  allocation.cull(encoder, culled, [buffers.freshDispatch, 0]);
  allocation.seal(encoder, composed, 1);
  const draws = shadows.freshDraws.made(),
    layer = lights.staticLayer;
  /** One pass over `descriptor` with group 2 `group` (and the static layer's at 3 when `from`),
   *  drawing `kinds` in turn, each a pipeline and its draw (`FRESH_*`): its pages cleared or
   *  restored, then its casters. */
  const drawPass = (
    descriptor: GPURenderPassDescriptor,
    at: number,
    group: GPUBindGroup,
    kinds: [GPURenderPipeline, number][],
    from?: GPUBindGroup,
  ) => {
    const pass = encoder.beginRenderPass(descriptor);
    pass.setBindGroup(0, groups.page);
    pass.setBindGroup(1, shadows.faceGroup, [0]);
    pass.setBindGroup(2, group);
    if (from) pass.setBindGroup(3, from);
    for (const [pipeline, kind] of kinds) {
      pass.setPipeline(pipeline);
      pass.drawIndirect(buffers.freshArgs, 4 * freshDrawWord(at, kind));
    }
    pass.end();
    lights.shadowRenderPasses++;
    lights.shadowDrawCalls += kinds.length;
    run.gpuDrawCalls += kinds.length;
  };
  for (let at = 0; at < layers; at++) {
    // With a static layer, as Unreal renders a new page's static casters into its static cache
    // and merges them under the dynamic ones (#831): the still casters into the layer, then the
    // pool's page restored from it and the moving casters alone over it. A mover crossing the
    // page later restores it too: its still geometry is drawn once.
    // Each layer's own descriptors (`layerPasses`): labelled for the GPU timing (#685).
    const cleared: [GPURenderPipeline, number] = [draws.clear, FRESH_CLEAR];
    if (layer) {
      drawPass(layer.freshPasses[at], at, groups.pool, [
        cleared,
        [draws.staticCasters, FRESH_STILL],
      ]);
      const restore: [GPURenderPipeline, number][] = [
        [draws.restore, FRESH_CLEAR],
        [draws.movingCasters, FRESH_MOVING],
      ];
      drawPass(shadows.passes[at], at, groups.pool, restore, layer.groups[at]);
    } else drawPass(shadows.passes[at], at, groups.pool, [cleared, [draws.casters, FRESH_CASTERS]]);
    if (tint)
      drawPass(tint.passes[at], at, groups.tint[at], [
        [draws.tintClear, FRESH_CLEAR],
        [draws.tintDepth, FRESH_CASTERS],
        [draws.tintColour, FRESH_CASTERS],
      ]);
  }
  plan.gpu.drew(run.frame, !!layer);
}
