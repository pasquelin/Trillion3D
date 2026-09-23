import { DRAW_INDIRECT_STRIDE } from '../../../gpu/draw/draw.ts';
import { MAX_SHADOW_REGIONS, SHADOW_PASS } from '../../../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../../../gpu/shadow/staticLayer.ts';
import { HIZ_UNTESTED } from '../../../gpu/shadow/occlusion.ts';
import { REGION_RESTORE, REGION_STATIC } from '../../shadow/regions.ts';
import { shadowRegionGroup } from '../../shadow/regionGroups.ts';
import { SHADOW_PAGE } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { encodeShadowCasters } from '../../shadow/casters.ts';

/** Pyramid slot of each region this frame, `HIZ_UNTESTED` for a region drawn as culled. */
const slotOf = new Uint32Array(MAX_SHADOW_REGIONS);

/**
 * The pages a moving caster is drawn over get a pyramid of their static layer, and each restored
 * region keeps only the moving casters it does not hide from the light
 * (`../../../gpu/shadow/occlusion.ts`). A frame without a restored region, or before the pyramids
 * exist, tests nothing. Returns whether the restored regions draw from the visible lists.
 */
function encodeOcclusion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, count: number) {
  const { lights, run, layout, setup } = rt,
    { regions, pageHiz, occlusion, cull, spheres, shadows } = lights;
  if (!pageHiz || !occlusion || !cull || !spheres || !shadows) return false;
  let pages = 0;
  for (let region = 0; region < count; region++)
    slotOf[region] = regions.startOf(region) === REGION_RESTORE ? pages++ : HIZ_UNTESTED;
  if (!pages) return false;
  pageHiz.encode(encoder, pages, (slot, out, at) => {
    let region = 0;
    while (slotOf[region] !== slot) region++;
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
  const rows = layout.rows.packedCount;
  occlusion.encode(encoder, inputs, count, (r) => slotOf[r], rows, setup.maxCorners, run.frame);
  return true;
}

/**
 * Shadow depth pass: first the casters of each light view drawn, selected from the light and
 * culled per region (`encodeShadowCasters`); then the static layer's pages drawn in full, if any;
 * then the moving casters of each restored page tested against its static layer; then one render
 * pass over the pool, where each region starts from its page cleared to far or restored from the
 * static layer, and draws its casters.
 *
 * **The viewport is the physical page, the matrix the virtual page's own projection.** The page
 * fills the clip square, so the rasterizer clips every caster at its edge and no other page of the
 * pool is touched; the scissor says the same square once more.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  count: number,
) {
  const { lights, vis, run } = rt,
    { shadows, cull, regions, staticLayer, occlusion } = lights;
  lights.shadowDraws = 0;
  if (!count || !shadows || !cull || !vis.visBindGroupLayout) return false;
  if (regions.layered && !staticLayer) return false;
  if (!shadowRegionGroup(rt, device, 0)) return false;
  if (!encodeShadowCasters(rt, encoder, count)) return false;
  cull.counts.sample(encoder, cull.indirect, count, run.frame);
  lights.shadowDraws = count;
  const drawsBefore = run.gpuDrawCalls;
  const draw = (target: GPUTextureView, label: string, layer: boolean, tested: boolean) => {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [],
      depthStencilAttachment: { view: target, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    for (let region = 0; region < count; region++) {
      const start = regions.startOf(region);
      if (layer !== (start === REGION_STATIC)) continue;
      const visible = tested && start === REGION_RESTORE;
      const group = shadowRegionGroup(rt, device, region, visible);
      if (!group) continue;
      const x = regions.x(region),
        y = regions.y(region);
      pass.setViewport(x, y, SHADOW_PAGE, SHADOW_PAGE, 0, 1);
      pass.setScissorRect(x, y, SHADOW_PAGE, SHADOW_PAGE);
      if (start === REGION_RESTORE) {
        pass.setPipeline(staticLayer!.restore);
        pass.setBindGroup(0, staticLayer!.group);
      } else {
        pass.setPipeline(shadows.clear);
        pass.setBindGroup(0, group);
        pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
      }
      pass.draw(3);
      pass.setPipeline(shadows.depth);
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
      const commands = visible ? occlusion!.visibleIndirect : cull.indirect;
      pass.drawIndirect(commands, region * DRAW_INDIRECT_STRIDE);
      run.gpuDrawCalls += 2;
    }
    pass.end();
  };
  if (regions.layered) draw(staticLayer!.view, SHADOW_LAYER_PASS, true, false);
  const tested = encodeOcclusion(rt, encoder, count);
  draw(shadows.view, SHADOW_PASS, false, tested);
  lights.shadowDrawCalls = run.gpuDrawCalls - drawsBefore;
  return true;
}
