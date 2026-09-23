import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { lightCutOf } from '../../gpu/dag/selection.ts';

/**
 * The frame's shadow casters, selected FROM THE LIGHT: each redrawn face runs its own cut, and the
 * regions of that face cull only what that cut kept.
 *
 * Under the GPU cut, a face's run is the camera's kernels on the light's view
 * (`../../gpu/dag/lightCut.ts`), then the draw compaction on the light's mask — the same two
 * steps that turn the camera's cut into the visibility pass's instances — then the region cull on
 * that list. Face after face in one command buffer: each run's list is consumed before the next
 * run writes it. The runs' streaming requests ride back in one copy, read after submission.
 *
 * Under the CPU cut, the same selection has already run on the CPU (`cpuCasters.ts`), and each
 * face's list waits at its own place in one buffer: only the region cull runs here.
 *
 * Returns false when a resource the frame needs is missing: the caller then reissues the pages.
 */
export function encodeShadowCasters(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  regions: number,
) {
  const { lights, vis, run, layout, setup, timing } = rt,
    { cull, spheres, runs } = lights,
    { gpuDraw } = vis;
  if (!cull || !spheres || !gpuDraw) return false;
  const rows = layout.rows.packedCount;
  cull.begin(regions, setup.maxCorners);
  const selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  const light = selection && lightCutOf(selection, MAX_SHADOW_REGIONS);
  lights.lightCut = light;
  if (light) {
    const compaction = gpuDraw.lightCompaction();
    const source = {
      spheres: spheres.buffer,
      source: compaction.instanceBuffer,
      base: 0,
      indirect: compaction.indirectBuffer,
      indirectBase: 0,
      commands: gpuDraw.slots,
    };
    for (let r = 0; r < runs.count; r++) {
      const face = runs.list[r];
      light.encode(encoder, r, face.uniforms);
      compaction.encode(encoder, rows, setup.maxCorners, light);
      cull.encode(encoder, source, r, face.first, face.count, rows);
    }
    lights.lightRuns = runs.count;
    timing.shadowRequests = light.encodeReadback(encoder);
    return true;
  }
  const lists = lights.cpuCasters;
  if (run.gpuFrameActive || !lists || lists.frame !== run.frame) return false;
  const source = {
    spheres: spheres.buffer,
    source: lists.source,
    base: 0,
    indirect: lists.indirect,
    indirectBase: 0,
    commands: 1,
  };
  for (let r = 0; r < runs.count; r++) {
    const face = runs.list[r];
    source.base = lists.bases[r];
    source.indirectBase = r * 4;
    cull.encode(encoder, source, r, face.first, face.count, lists.lengths[r]);
  }
  lights.lightRuns = runs.count;
  return true;
}
