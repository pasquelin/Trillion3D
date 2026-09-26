import type { ShadowTransmittance } from '../../../gpu/shadow/transmittance.ts';
import { pagePlan } from '../../shadow/pagePasses.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { drawRegionCasters } from './encodeRegionDraws.ts';

/**
 * The pass of the transmittance layer (`../../../gpu/shadow/transmittance.ts`), at half the pool's
 * resolution, one render pass per pool pass of the batch planned in `pagePlan`: every page the
 * pool's pass drew — cleared or restored — starts from all the light and no translucent depth (the
 * static layer keeps no blended caster: their rows count as moving), one instanced draw for the
 * pass (`../../../gpu/shadow/pageQuads.ts`); then each region draws its list twice in its page's
 * viewport, where only the blended casters' corners survive: depth only, for the nearest
 * translucent depth, then colour only, multiplied into the transmittance. Both test the pool's
 * opaque depth, just drawn; `tested` names the regions that draw their visible lists. Once the last
 * blended caster has given its row back, the layer stays but the list holds none of them: each
 * page is cleared, which is all the read needs, and neither draw is encoded.
 */
export function encodeTransmittance(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  layer: ShadowTransmittance,
  tested: boolean,
) {
  const { lights, run } = rt,
    quads = lights.pageQuads!;
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
      run.gpuDrawCalls += drawRegionCasters(rt, device, pass, k, tested, 2, layer.draws);
    }
    pass.end();
  }
}
