import { pagePlan, planPagePasses } from '../../shadow/pagePasses.ts';
import { shadowRegionGroup } from '../../shadow/regionGroups.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { encodeShadowCasters } from '../../shadow/casters.ts';
import { drawRegionCasters, encodeOcclusion } from './encodeRegionDraws.ts';
import { encodeTransmittance } from './encodeTransmittance.ts';

/**
 * Shadow depth pass of one batch, pages `[from, to)` of the frame's list in `count` regions: first
 * their face uniforms, then the casters of each light view drawn, selected from the light and
 * culled per region (`encodeShadowCasters`); then the static layer's pages drawn in full, if any;
 * then the moving casters of each restored page tested against its static layer; then a render
 * pass per layer of the pool. In each pass, every region starts from its page cleared to far or
 * restored from the static layer — two instanced draws for the pass, whatever its regions
 * (`../../../gpu/shadow/pageQuads.ts`) —, then draws its casters.
 *
 * **The casters' viewport is the physical page, the matrix the virtual page's own projection.**
 * The page fills the clip square, so the rasterizer clips every caster at its edge and no other
 * page of the pool is touched; the scissor says the same square once more.
 *
 * Once a blended caster has held a row, the pass of the transmittance layer follows
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
    { shadows, cull, regions, staticLayer, pageQuads: quads } = lights;
  if (!count || !shadows?.texture || !cull || !quads || !vis.visBindGroupLayout) return false;
  if (regions.layered && !staticLayer) return false;
  if (!shadowRegionGroup(rt, device, 0)) return false;
  shadows.flushPages(count);
  if (!encodeShadowCasters(rt, encoder, count, from, to, runBase)) return false;
  cull.counts.sample(encoder, cull.indirect, count, run.frame);
  lights.shadowDraws += count;
  const drawsBefore = run.gpuDrawCalls;
  planPagePasses(regions, count);
  const { order, layer, first, clears, restores, layerPasses } = pagePlan;
  quads.begin(count, order);
  const depth = [shadows.depth];
  // Each pass of the static layer's (`inLayer`) or the pool's: its clears and restores, two
  // instanced draws, then each region's casters in its page's viewport.
  const draw = (passes: GPURenderPassDescriptor[], inLayer: boolean, tested: boolean) => {
    const end = inLayer ? layerPasses : pagePlan.passes;
    for (let k = inLayer ? 0 : layerPasses; k < end; k++) {
      const at = layer[k],
        pass = encoder.beginRenderPass(passes[at]);
      lights.shadowRenderPasses++;
      run.gpuDrawCalls += quads.encode(
        pass,
        first[k],
        clears[k],
        restores[k],
        staticLayer?.groups[at],
      );
      run.gpuDrawCalls += drawRegionCasters(rt, device, pass, k, tested, 1, depth);
      pass.end();
    }
  };
  if (regions.layered) draw(staticLayer!.passes, true, false);
  const tested = encodeOcclusion(rt, encoder, count);
  draw(shadows.passes, false, tested);
  const casters = rt.services.blendCasters.used > 0;
  const transmittance = casters ? shadows.ensureTransmittance(encoder) : shadows.transmittance;
  if (transmittance) encodeTransmittance(rt, device, encoder, quads, transmittance, tested);
  lights.shadowDrawCalls += run.gpuDrawCalls - drawsBefore;
  return true;
}
