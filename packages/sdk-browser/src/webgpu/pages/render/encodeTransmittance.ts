import type { ShadowPageQuads } from '../../../gpu/shadow/pageQuads.ts';
import type { ShadowTransmittance } from '../../../gpu/shadow/transmittance.ts';
import { pagePlan } from '../../shadow/pagePasses.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { drawRegionCasters } from './encodeRegionDraws.ts';

/**
 * The pass of the transmittance layer (`../../../gpu/shadow/transmittance.ts`), at half the pool's
 * resolution, one render pass per pool pass of `pagePlan`: every page the pool's pass drew starts
 * from all the light and far, in one instanced clear (`quads`) — a region `drawRegionCasters`
 * skips for want of its groups is cleared too —, then `drawRegionCasters` draws each region's
 * blended casters at half its place, depth only then colour only, both against the pool's opaque
 * depth; the restored pages its moving groups hold (`grouped`), by group (`movingGroups.ts`).
 * With no blended caster left, the pages are only cleared.
 */
export function encodeTransmittance(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  quads: ShadowPageQuads,
  layer: ShadowTransmittance,
  tested: boolean,
  grouped?: Uint32Array,
) {
  const { lights, run } = rt;
  const casters = rt.services.blendCasters.used > 0;
  const { layer: layers, first, clears, restores, layerPasses, passes } = pagePlan;
  for (let k = layerPasses; k < passes; k++) {
    const at = layers[k],
      pass = encoder.beginRenderPass(layer.passes[at]);
    lights.shadowRenderPasses++;
    quads.clearTransmittance(pass, first[k], clears[k] + restores[k]);
    run.gpuDrawCalls++;
    if (casters) {
      pass.setBindGroup(2, layer.opaqueGroups[at]);
      run.gpuDrawCalls += drawRegionCasters(rt, device, pass, k, tested, 2, layer.draws, grouped);
      if (grouped) run.gpuDrawCalls += lights.movingGroups!.drawBlend(rt, pass, k, at);
    }
    pass.end();
  }
}
