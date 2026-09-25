import { DRAW_INDIRECT_STRIDE } from '../../../gpu/draw/draw.ts';
import { MAX_SHADOW_REGIONS, SHADOW_PASS } from '../../../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../../../gpu/shadow/staticLayer.ts';
import { HIZ_UNTESTED } from '../../../gpu/shadow/occlusion.ts';
import { REGION_RESTORE, REGION_STATIC } from '../../shadow/regions.ts';
import { shadowRegionGroup } from '../../shadow/regionGroups.ts';
import { SHADOW_PAGE } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { encodeShadowCasters } from '../../shadow/casters.ts';
import {
  SHADOW_TRANSMITTANCE_PASS,
  type ShadowTransmittance,
} from '../../../gpu/shadow/transmittance.ts';

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
function encodeOcclusion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, count: number) {
  const { lights, run, layout, setup } = rt,
    { regions, pageHiz, occlusion, cull, spheres, shadows } = lights;
  if (!pageHiz || !occlusion || !cull || !spheres || !shadows) return false;
  let pages = 0;
  for (let region = 0; region < count; region++) {
    const restored = regions.startOf(region) === REGION_RESTORE;
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
 * Shadow depth pass of one batch, pages `[from, to)` of the frame's list in `count` regions: first
 * their face uniforms, then the casters of each light view drawn, selected from the light and
 * culled per region (`encodeShadowCasters`); then the static layer's pages drawn in full, if any;
 * then the moving casters of each restored page tested against its static layer; then one render
 * pass over the pool, where each region starts from its page cleared to far or restored from the
 * static layer, and draws its casters.
 *
 * **The viewport is the physical page, the matrix the virtual page's own projection.** The page
 * fills the clip square, so the rasterizer clips every caster at its edge and no other page of the
 * pool is touched; the scissor says the same square once more.
 *
 * Once a blended caster holds a row, the pass of the transmittance layer follows
 * (`encodeTransmittance`). Before, the shadow passes are the ones they were.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  count: number,
  from: number,
  to: number,
  runBase: number,
) {
  const { lights, vis, run } = rt,
    { shadows, cull, regions, staticLayer, occlusion } = lights;
  if (!count || !shadows?.view || !cull || !vis.visBindGroupLayout) return false;
  if (regions.layered && !staticLayer) return false;
  if (!shadowRegionGroup(rt, device, 0)) return false;
  shadows.flushPages(count);
  if (!encodeShadowCasters(rt, encoder, count, from, to, runBase)) return false;
  cull.counts.sample(encoder, cull.indirect, count, run.frame);
  lights.shadowDraws += count;
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
  const transmittance = rt.services.blendCasters.used
    ? shadows.ensureTransmittance(encoder)
    : shadows.transmittance;
  if (transmittance) encodeTransmittance(rt, device, encoder, count, transmittance, tested);
  lights.shadowDrawCalls += run.gpuDrawCalls - drawsBefore;
  return true;
}

/**
 * The pass of the transmittance layer (`../../../gpu/shadow/transmittance.ts`), at half the pool's
 * resolution: every page the pool's pass drew — cleared or restored — starts from all the light
 * and no translucent depth (the static layer keeps no blended caster: their rows count as moving),
 * then draws its list twice, where only the blended casters' corners survive: depth only, for the
 * nearest translucent depth, then colour only, multiplied into the transmittance. Both test the
 * pool's opaque depth, just drawn.
 */
export function encodeTransmittance(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  count: number,
  layer: ShadowTransmittance,
  tested: boolean,
) {
  const { lights, run } = rt,
    { shadows, cull, regions, occlusion } = lights;
  const pass = encoder.beginRenderPass({
    label: SHADOW_TRANSMITTANCE_PASS,
    colorAttachments: [{ view: layer.view, loadOp: 'load', storeOp: 'store' }],
    depthStencilAttachment: { view: layer.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setBindGroup(2, layer.opaqueGroup);
  const half = SHADOW_PAGE / 2;
  for (let region = 0; region < count; region++) {
    const start = regions.startOf(region);
    if (start === REGION_STATIC) continue;
    const visible = tested && start === REGION_RESTORE;
    const group = shadowRegionGroup(rt, device, region, visible);
    if (!group) continue;
    const x = regions.x(region) / 2,
      y = regions.y(region) / 2;
    pass.setViewport(x, y, half, half, 0, 1);
    pass.setScissorRect(x, y, half, half);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, shadows!.faceGroup, [region * shadows!.faceStride]);
    pass.setPipeline(layer.clear);
    pass.draw(3);
    const commands = visible ? occlusion!.visibleIndirect : cull!.indirect;
    for (const pipeline of [layer.depth, layer.blend]) {
      pass.setPipeline(pipeline);
      pass.drawIndirect(commands, region * DRAW_INDIRECT_STRIDE);
    }
    run.gpuDrawCalls += 3;
  }
  pass.end();
}
