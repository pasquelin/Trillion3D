import { pagePlan, planPagePasses } from '../../shadow/pagePasses.ts';
import { shadowRegionGroup } from '../../shadow/regionGroups.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { encodeShadowCasters } from '../../shadow/casters.ts';
import { drawRegionCasters, encodeOcclusion } from './encodeRegionDraws.ts';
import { encodeTransmittance } from './encodeTransmittance.ts';
import { frameTransmittance } from '../../shadow/transmittanceGrant.ts';
import { feedbackPublished } from './encoder.ts';

/**
 * Shadow depth pass of one batch, pages `[from, to)` of the frame's list in `count` regions: first
 * their face uniforms, then the casters of each light view drawn, selected from the light and
 * culled per region (`encodeShadowCasters`); then the static layer's pages drawn in full, if any;
 * then the moving casters of each restored page tested against its static layer; then a render
 * pass per layer of the pool. In each pass, every region starts from its page cleared to far or
 * restored from the static layer — two instanced draws for the pass, whatever its regions
 * (`../../../gpu/shadow/pageQuads.ts`) —, then draws its casters: the moving casters of its
 * restored pages by group, one or two instanced draws each (`../../shadow/movingGroups.ts`).
 *
 * **The casters' viewport is the physical page, the matrix the virtual page's own projection.**
 * The page fills the clip square, so the rasterizer clips every caster at its edge and no other
 * page of the pool is touched; the scissor says the same square once more.
 *
 * Once a blended caster has held a row, the pass of the transmittance layer follows
 * (`encodeTransmittance`), the layer granted under the shadows' grant (`frameTransmittance`).
 * Before, the shadow passes are the ones they were.
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
  // The cutouts ask for the tiles they read, under the image's word (`faceBindings.ts`); an image
  // whose feedback is not published — a capture, or the feedback A/B's arm without it
  // (`encoder.ts`) — asks nothing.
  const feedback = feedbackPublished(rt) ? vis.textures?.feedback : undefined;
  shadows.cutoutRequests(feedback?.phaseWord(run.textureConverging) ?? 0, feedback?.buffer);
  if (!encodeShadowCasters(rt, encoder, count, from, to, runBase)) return false;
  cull.counts.sample(encoder, cull.indirect, count, run.frame, regions.moving);
  lights.shadowWork.regions += count;
  const drawsBefore = run.gpuDrawCalls;
  planPagePasses(regions, count);
  const { order, layer, first, clears, restores, layerPasses } = pagePlan;
  quads.begin(count, order);
  const depthDraws = shadows.depthDraws();
  // Each pass of the static layer's (`inLayer`) or the pool's: its clears and restores, two
  // instanced draws, then each region's casters in its page's viewport, or by group (`grouped`).
  const draw = (
    passes: GPURenderPassDescriptor[],
    inLayer: boolean,
    tested: boolean,
    grouped?: Uint32Array,
  ) => {
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
      const draws =
        drawRegionCasters(rt, device, pass, k, tested, 1, depthDraws, grouped) +
        (grouped ? lights.movingGroups!.draw(rt, pass, k) : 0);
      run.gpuDrawCalls += draws;
      // A pool pass restores its pages from the static layer and draws their moving casters, or
      // clears them and draws every caster: no frame does both (`pool.drawMode`).
      lights.shadowWork.drewLayer(at);
      lights.shadowWork.drewPass(draws, inLayer ? 0 : restores[k]);
      pass.end();
    }
  };
  if (regions.layered) draw(staticLayer!.passes, true, false);
  const tested = encodeOcclusion(rt, encoder, count);
  // The restored sun pages' moving casters, by group (`movingGroups.ts`): after the lists they read.
  const groups = lights.movingGroups?.encode(rt, encoder, count, tested) ?? 0,
    grouped = groups ? lights.movingGroups!.grouped : undefined;
  draw(shadows.passes, false, tested, grouped);
  const casters = rt.services.blendCasters.used > 0;
  const transmittance = casters ? frameTransmittance(rt, encoder) : shadows.transmittance;
  if (transmittance)
    encodeTransmittance(rt, device, encoder, quads, transmittance, tested, grouped);
  lights.shadowDrawCalls += run.gpuDrawCalls - drawsBefore;
  return true;
}
