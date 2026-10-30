import { readHeterogeneousVolumeSetting } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewPublished } from '../../frame/backend/state/viewPublished.ts'

/**
 * WHAT THE LIT PASSES KNOW OF THE VOLUMES' SHADOWS, apart from the frame that builds them (`liveShadingFrame.ts`), so that the lights'
 * resources (`frame/prepare/contractLight.ts`) read it without importing the frame: whether the scene has volumes that cast shadows into the
 * lights, and the buffer that holds the maps of the lights the last image built for them (`beerShadowReadWgsl.ts` reads it).
 */

/** Whether the scene has volumes that cast shadows into the lights: the lit passes then hold the read of them (`ContractKey.volumeShadow`). */
export const volumeShadowsOn = (rt: WebgpuPagesRuntime) =>
  !!rt.context.sceneHeterogeneousVolumes?.count &&
  !!readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumes') &&
  !!readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumesAllowed') &&
  !!readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumesShadows')

const published = viewPublished<GPUBuffer>()

/** The buffer that holds the maps of the lights the last image built for the volumes' shadows, none where the volumes cast none. */
export const heterogeneousShadowBufferOf = published.of

/** Gives the buffer of the maps the image built, or none (`undefined`). */
export const publishHeterogeneousShadowBuffer = published.publish
