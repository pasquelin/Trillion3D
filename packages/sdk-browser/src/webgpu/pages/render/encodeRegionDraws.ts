import { DRAW_INDIRECT_STRIDE } from '../../../gpu/draw/draw.ts';
import { SHADOW_REGION_INDIRECT_BYTES } from '../../../gpu/shadow/batchBudget.ts';
import type { ShadowDepthDraws } from '../../../gpu/shadow/depthDraws.ts';
import { MAX_SHADOW_REGIONS } from '../../../gpu/shadow/atlas.ts';
import { HIZ_UNTESTED } from '../../../gpu/shadow/occlusion.ts';
import { REGION_RESTORE } from '../../shadow/regions.ts';
import { pagePlan } from '../../shadow/pagePasses.ts';
import { shadowRegionGroup } from '../../shadow/regionGroups.ts';
import { SHADOW_PAGE } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Pyramid slot of each region this frame, `HIZ_UNTESTED` for a region drawn as culled, and the
 *  region each slot was given to. */
const slotOf = new Uint32Array(MAX_SHADOW_REGIONS),
  regionOf = new Uint32Array(MAX_SHADOW_REGIONS);

/**
 * The pages a moving caster is drawn over get a pyramid of their static layer, and each restored
 * region keeps only the moving casters it does not hide from the light
 * (`../../../gpu/shadow/occlusion.ts`). A frame without a restored region, or before the pyramids
 * exist, tests nothing. Returns whether the restored regions draw from the visible lists.
 */
export function encodeOcclusion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, count: number) {
  const { lights, run, layout, setup } = rt,
    { regions, pageHiz, occlusion, cull, spheres, shadows } = lights;
  if (!pageHiz || !occlusion || !cull || !spheres || !shadows) return false;
  let pages = 0;
  for (let region = 0; region < count; region++) {
    // The pyramids read the first layer: a page past it draws its moving casters untested.
    const restored = regions.startOf(region) === REGION_RESTORE && !regions.layer(region);
    if (restored) regionOf[pages] = region;
    slotOf[region] = restored ? pages++ : HIZ_UNTESTED;
  }
  if (!pages) return false;
  pageHiz.encode(encoder, pages, (slot, out, at) => {
    const region = regionOf[slot];
    out[at] = regions.x(region);
    out[at + 1] = regions.y(region);
  });
  const inputs = {
    spheres: spheres.buffer,
    kept: cull.kept,
    indirect: cull.indirect,
    views: shadows.faceUniform,
    pyramid: pageHiz.pyramid,
  };
  // A list holds the visibility rows and the blended casters' rows in use, at most.
  const rows = layout.rows.packedCount + rt.services.blendCasters.used;
  occlusion.encode(encoder, inputs, count, (r) => slotOf[r], rows, setup.maxCorners, run.frame);
  return true;
}

/**
 * The casters of each region of pass `k` of `pagePlan` drawn into `pass`, in its page's viewport
 * and scissor — the page's texels divided by `scale`, 2 in the transmittance layer —: the page
 * fills the clip square, so the rasterizer clips every caster at its edge and no other page is
 * touched. A region draws its visible lists when `tested` and it has a pyramid, else the cull's.
 * The pool's `draws` draw both of a region's lists (#965): the opaque one with no fragment stage,
 * or with the fragment that strips the face's emitter envelope, then the cutout one while any row
 * is a cutout; the transmittance layer's draw the first list, which holds the blended casters,
 * once each. A region whose light view has no caster on the CPU cut (`regions.casterless`) keeps
 * zero instances in every command: it encodes no bind group and no draw (#1210). A pipeline is set
 * only when it changes. Returns the draws encoded.
 */
export function drawRegionCasters(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  k: number,
  tested: boolean,
  scale: number,
  draws: readonly GPURenderPipeline[] | ShadowDepthDraws,
) {
  const { shadows, cull, regions, occlusion } = rt.lights,
    { order, first, clears, restores } = pagePlan,
    side = SHADOW_PAGE / scale;
  const pool = 'cutout' in draws ? draws : undefined,
    cutouts = rt.lights.mobility.hasCutouts;
  let current: GPURenderPipeline | undefined,
    drawn = 0;
  const draw = (pipeline: GPURenderPipeline, commands: GPUBuffer, offset: number) => {
    if (pipeline !== current) pass.setPipeline((current = pipeline));
    pass.drawIndirect(commands, offset);
    drawn++;
  };
  for (let i = first[k]; i < first[k] + clears[k] + restores[k]; i++) {
    const region = order[i];
    if (regions.casterless(region)) continue;
    const visible = tested && slotOf[region] !== HIZ_UNTESTED;
    const group = shadowRegionGroup(rt, device, region, visible);
    if (!group) continue;
    const x = regions.x(region) / scale,
      y = regions.y(region) / scale;
    pass.setViewport(x, y, side, side, 0, 1);
    pass.setScissorRect(x, y, side, side);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, shadows!.faceGroup, [region * shadows!.faceStride]);
    const commands = visible ? occlusion!.visibleIndirect : cull!.indirect,
      at = region * SHADOW_REGION_INDIRECT_BYTES;
    if (pool) {
      draw(shadows!.hasEnvelope(region) ? pool.envelope : pool.opaque, commands, at);
      if (cutouts) draw(pool.cutout, commands, at + DRAW_INDIRECT_STRIDE);
    } else
      for (const pipeline of draws as readonly GPURenderPipeline[]) draw(pipeline, commands, at);
  }
  return drawn;
}
