import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_CASTERS, FRESH_CLEAR, freshDrawWord } from './freshLayout.ts';
import { freshSlices, freshWanted } from './freshInputs.ts';
import { freshGroups } from './freshGroups.ts';
import { growPairList } from './pairGrowth.ts';
import { keptPairs, poolPairs } from './pairRows.ts';
import { FRESH_LAYER_PASS, type ShadowStaticLayer } from '../../gpu/shadow/staticLayer.ts';

/** The static layer's passes of the GPU's own pages, labelled apart from the host's layer passes
 *  (`SHADOW_LAYER_PASS`): made once a layer. */
const layerPasses = new WeakMap<ShadowStaticLayer, GPURenderPassDescriptor[]>();
const freshLayerPasses = (layer: ShadowStaticLayer) => {
  let passes = layerPasses.get(layer);
  if (!passes) {
    passes = layer.passes.map((pass) => ({ ...pass, label: FRESH_LAYER_PASS }));
    layerPasses.set(layer, passes);
  }
  return passes;
};

/** The blended casters' rows, rewritten each frame: a frame allocates nothing. */
const blend: [number, number] = [0, 0];

/**
 * THE PAGES THE GPU MAPPED AND NO DRAW HAS FILLED, DRAWN IN THE FRAME THAT ASKS FOR THEM (#1275),
 * after the host's batches and table words, before the resolve reads any page — every one, a page
 * whose pairs the kept list could not hold the next frame or the host's (#1363, #831). One
 * workgroup composes them into regions (`freshWgsl.ts`); the pair cull counts, admits whole and
 * keeps, for each, every caster row its page's light-space volume touches (`freshCullWgsl.ts`) —
 * the table's rows are every resident page of every caster, the camera no part of it — in the
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
  // The frame's pairs, never more, though the host's caster rows widen the list (`poolPairs`): a
  // region past them waits, whole, for the next frame or the host's draw.
  const capacity = Math.min(keptPairs(cull.capacity), poolPairs(side * side * layers));
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
  const draws = shadows.freshDraws.made(),
    layer = lights.staticLayer;
  /** One pass over `descriptor` with group 2 `group` (and the static layer's at 3 when `from`),
   *  drawing `kinds` in turn: its pages cleared or restored, then its casters. */
  const drawPass = (
    descriptor: GPURenderPassDescriptor,
    at: number,
    group: GPUBindGroup,
    kinds: GPURenderPipeline[],
    from?: GPUBindGroup,
  ) => {
    const pass = encoder.beginRenderPass(descriptor);
    pass.setBindGroup(0, groups.page);
    pass.setBindGroup(1, shadows.faceGroup, [0]);
    pass.setBindGroup(2, group);
    if (from) pass.setBindGroup(3, from);
    kinds.forEach((pipeline, k) => {
      pass.setPipeline(pipeline);
      pass.drawIndirect(buffers.freshArgs, 4 * freshDrawWord(at, k ? FRESH_CASTERS : FRESH_CLEAR));
    });
    pass.end();
    lights.shadowRenderPasses++;
    lights.shadowDrawCalls += kinds.length;
    run.gpuDrawCalls += kinds.length;
  };
  for (let at = 0; at < layers; at++) {
    // With a static layer, as the reference engine renders a new page's static casters into its static cache
    // and merges them under the dynamic ones (#831): the still casters into the layer, then the
    // pool's page restored from it and the moving casters alone over it. A mover crossing the
    // page later restores it too: its still geometry is drawn once.
    if (layer)
      drawPass(freshLayerPasses(layer)[at], at, groups.pool, [draws.clear, draws.staticCasters]);
    // The layer's own descriptors (`layerPasses`): labelled for the GPU timing (#685).
    if (layer)
      drawPass(
        shadows.passes[at],
        at,
        groups.pool,
        [draws.restore, draws.movingCasters],
        layer.groups[at],
      );
    else drawPass(shadows.passes[at], at, groups.pool, [draws.clear, draws.casters]);
    if (tint)
      drawPass(tint.passes[at], at, groups.tint[at], [
        draws.tintClear,
        draws.tintDepth,
        draws.tintColour,
      ]);
  }
  plan.gpu.drew(run.frame, !!layer);
}
