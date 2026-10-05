import { syncFeedbackTarget, type FeedbackPipelines } from '../prepare/feedbackVariant.ts';
import { sha256Hex } from '../../../streaming/sha256Hex.ts';
import { readGpuImage } from '../../../gpu/core/presentation.ts';
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts';
import { createWebgpuShadePipelines } from '../../visibility/shadePipelines.ts';
import { blendWritesShare } from '../prepare/asIsShareTarget.ts';
import { blendContext } from '../prepare/contractLight.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The pipelines one arm binds: the resolve's classes and the blends of `vis`, and `water`. */
const pipelinesOf = (
  { shadeClasses, blendPipelines }: Omit<FeedbackPipelines, 'water'>,
  water: FeedbackPipelines['water'],
): FeedbackPipelines => ({ shadeClasses, blendPipelines, water });

export type FeedbackAbState = {
  target: boolean;
  force: boolean;
  on: FeedbackPipelines;
  off: FeedbackPipelines;
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
    rt.vis.writesEmissiveAo,
    rt.vis.shadeCache?.constants,
  );
  const blend = await createWebgpuBlendPipelines(
    device,
    rt.blendState.blendGpu,
    undefined,
    false,
    rt.vis.blendBindGroupLayout,
    blendWritesShare(rt),
    blendContext(rt),
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
    if (!rt.gpu.hdrTexture) throw new Error('FEEDBACK_AB_TARGETS_MISSING');
    const selected = target ? state.on : state.off;
    rt.vis.shadeClasses = selected.shadeClasses;
    rt.vis.blendPipelines = selected.blendPipelines;
    rt.blendState.water = selected.water;
    rt.vis.writesFeedback = state.target = target;
    syncFeedbackTarget(rt, device);
  }
  state.force = true;
}
