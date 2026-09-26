import { DRAW_INDIRECT_STRIDE } from '../../../gpu/draw/draw.ts';
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
 * The casters of each region of pass `k` of `pagePlan` drawn into `pass` by each of `pipelines`,
 * in its page's viewport and scissor — the page's texels divided by `scale`, 2 in the
 * transmittance layer —: the page fills the clip square, so the rasterizer clips every caster at
 * its edge and no other page is touched. A region draws its visible list when `tested` and it has
 * a pyramid, else the cull's. Returns the draws encoded.
 */
export function drawRegionCasters(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  k: number,
  tested: boolean,
  scale: number,
  pipelines: readonly GPURenderPipeline[],
) {
  const { shadows, cull, regions, occlusion } = rt.lights,
    { order, first, clears, restores } = pagePlan,
    side = SHADOW_PAGE / scale;
  const one = pipelines.length === 1;
  if (one) pass.setPipeline(pipelines[0]);
  let draws = 0;
  for (let i = first[k]; i < first[k] + clears[k] + restores[k]; i++) {
    const region = order[i],
      visible = tested && slotOf[region] !== HIZ_UNTESTED;
    const group = shadowRegionGroup(rt, device, region, visible);
    if (!group) continue;
    const x = regions.x(region) / scale,
      y = regions.y(region) / scale;
    pass.setViewport(x, y, side, side, 0, 1);
    pass.setScissorRect(x, y, side, side);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, shadows!.faceGroup, [region * shadows!.faceStride]);
    const commands = visible ? occlusion!.visibleIndirect : cull!.indirect;
    for (const pipeline of pipelines) {
      if (!one) pass.setPipeline(pipeline);
      pass.drawIndirect(commands, region * DRAW_INDIRECT_STRIDE);
    }
    draws += pipelines.length;
  }
  return draws;
}
