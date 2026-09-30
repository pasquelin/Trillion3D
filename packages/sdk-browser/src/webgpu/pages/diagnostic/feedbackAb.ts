import { makeFeedbackTarget } from '../prepare/targets.ts';
import { sha256Hex } from '../../../measurement/sha256Hex.ts';
import { readGpuImage } from '../../../gpu/core/presentation.ts';
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts';
import { createWebgpuShadePipelines } from '../../visibility/pipelines.ts';
import { blendWritesShare } from '../prepare/asIsShareTarget.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

type Pipelines = Pick<WebgpuPagesRuntime['vis'], (typeof VIS_PIPELINES)[number]> &
  Pick<WebgpuPagesRuntime['blendState'], 'water'>;
const VIS_PIPELINES = [
  'shadePipelineFor',
  'shadePipelines',
  'singleShadePipelines',
  'blendPipelines',
] as const;
const pipelinesOf = (vis: Omit<Pipelines, 'water'>, water: Pipelines['water']) =>
  ({ ...Object.fromEntries(VIS_PIPELINES.map((key) => [key, vis[key]])), water }) as Pipelines;

export type FeedbackAbState = {
  target: boolean;
  force: boolean;
  on: Pipelines;
  off: Pipelines;
};

export type ResidencyIdentity = {
  geometry: { count: number; sha256: string };
  tiles: { count: number; sha256: string };
};

const digest = async (keys: string[]) => ({
  count: keys.length,
  sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(keys)).buffer as ArrayBuffer),
});

/** Exact-key snapshots are taken before hashing, so an async GPU readback cannot shift them. */
export async function feedbackAbResidency(rt: WebgpuPagesRuntime): Promise<ResidencyIdentity> {
  if (!rt.feedbackAB) throw new Error('FEEDBACK_AB_UNAVAILABLE');
  const cache = rt.gpu.cache;
  const textures = rt.vis.textures;
  if (!cache || !textures) throw new Error('FEEDBACK_AB_RESIDENCY_UNAVAILABLE');
  // The scene catalogue covers every cache address; reject a partial inventory.
  const geometry = rt.setup.tracking.pageCatalog.filter((key) => cache.get(key)).sort();
  if (geometry.length !== cache.stats().residentPages)
    throw new Error('FEEDBACK_AB_RESIDENCY_CATALOGUE_INCOMPLETE');
  const tiles = [textures.color, textures.data]
    .flatMap((atlas) =>
      atlas.pools.flatMap((pool) =>
        pool.occupied().map((index) => `${pool.label}:${pool.keyOf(index)}`),
      ),
    )
    .sort();
  const [pages, keys] = await Promise.all([digest(geometry), digest(tiles)]);
  return { geometry: pages, tiles: keys };
}

/** Captures the last submitted color target directly, without the convergence barrier. */
export async function captureFeedbackAb(rt: WebgpuPagesRuntime) {
  if (!rt.feedbackAB || !rt.gpu.device || !rt.gpu.displayTexture || rt.capture.capturing)
    throw new Error('FEEDBACK_AB_CAPTURE_UNAVAILABLE');
  const [width, height] = rt.gpu.displaySize;
  if (!width || !height || !rt.run.imageRevision) throw new Error('FEEDBACK_AB_IMAGE_MISSING');
  return readGpuImage(rt.gpu.device, rt.gpu.displayTexture, width, height, rt.signal);
}

/** Prepares both layouts before any diagnostic timing; the live scene and pools stay shared. */
export async function prepareFeedbackAb(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
) {
  if (rt.context.diagnosticGpuVariant) throw new Error('FEEDBACK_AB_VARIANT_UNSUPPORTED');
  const shade = await createWebgpuShadePipelines(
    device,
    shadeModule,
    classes,
    undefined,
    false,
    rt.vis.shadeBindGroupLayout,
  );
  const blend = await createWebgpuBlendPipelines(
    device,
    rt.blendState.blendGpu,
    undefined,
    false,
    rt.vis.blendBindGroupLayout,
    blendWritesShare(rt),
    rt.lights.plan.sunWindow,
  );
  if (blend.waterRefused) throw blend.waterRefused;
  if (rt.blendState.transmissive > 0 && !rt.blendState.water)
    throw new Error('FEEDBACK_AB_WATER_PATH_UNAVAILABLE');
  rt.feedbackAB = {
    target: true,
    force: false,
    on: pipelinesOf(rt.vis, rt.blendState.water),
    off: pipelinesOf({ ...shade, blendPipelines: blend.blendPipelines }, blend.water),
  };
}

/** A frame-boundary diagnostic switch; callers must first converge the same frozen pose. */
export async function setFeedbackTargetAb(rt: WebgpuPagesRuntime, target: boolean) {
  const state = rt.feedbackAB;
  const device = rt.gpu.device;
  if (!state || !device) throw new Error('FEEDBACK_AB_UNAVAILABLE');
  if (rt.views.active !== rt.views.main || rt.capture.capturing)
    throw new Error('FEEDBACK_AB_VIEW_BUSY');
  if (!state.force && !rt.run.frameHeld) throw new Error('FEEDBACK_AB_POSE_NOT_HELD');
  const texture = rt.vis.textures?.metrics();
  if (
    !texture ||
    texture.textureTilesPending ||
    texture.textureMissingLevels ||
    texture.textureTilesRequested !== texture.textureTilesAtLevel
  )
    throw new Error('FEEDBACK_AB_TEXTURES_NOT_RESIDENT');
  await device.queue.onSubmittedWorkDone();
  await rt.vis.textures?.settled();
  if (state.target !== target) {
    const [width, height] = rt.gpu.targetSize;
    if (!width || !height) throw new Error('FEEDBACK_AB_TARGETS_MISSING');
    if (target) makeFeedbackTarget(rt, device, width, height);
    else {
      rt.gpu.feedbackTexture?.destroy();
      rt.gpu.feedbackTexture = rt.gpu.feedbackView = undefined;
    }
    rt.gpu.targetBytes += (target ? 1 : -1) * width * height * 4;
    const selected = target ? state.on : state.off;
    for (const key of VIS_PIPELINES) Object.assign(rt.vis, { [key]: selected[key] });
    rt.blendState.water = selected.water;
    state.target = target;
  }
  state.force = true;
}
