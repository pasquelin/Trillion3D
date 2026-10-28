import { readHeterogeneousVolumeSetting } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import type { ResolvedHeterogeneousVolume } from '../../../../sdk-core/src/scene/heterogeneousVolume/contracts.ts'
import { packVolume } from './liveShadingPack.ts'
import { HV_ALL_LIGHTS } from './liveShadingPack.ts'
/**
 * THE RESOURCES OF THE LIVE SHADING: the buffer of a volume's data (`HvVolume`, `liveShadingWgsl.ts`),
 * the size of its lighting cache, the cache itself, and the downsampled image.
 */

/**
 * The voxels of the lighting cache of a volume of `resolution` voxels: the resolution over the
 * downsample factor — the override when it is above 0, else the volume's own (`lightingDownsample`)
 * —, held to 1 up to 1024, 1024 and 512 a side (`GetLightingCacheResolution`,
 * `HeterogeneousVolumes.cpp:889-901`).
 */
export function lightingCacheResolution(
  resolution: readonly [number, number, number],
  override: number,
  lightingDownsample: number,
): [number, number, number] {
  const factor = override > 0 ? override : lightingDownsample
  const held = (side: number, most: number) =>
    Math.min(Math.max(Math.trunc(side / factor), 1), most)
  return [held(resolution[0], 1024), held(resolution[1], 1024), held(resolution[2], 512)]
}

/** The size of the image of the volumes at `factor` times fewer pixels a side (`GetDownsampledResolution`). */
export const downsampledSize = (size: readonly [number, number], factor: number) =>
  [Math.ceil(size[0] / factor), Math.ceil(size[1] / factor)] as const

/**
 * The lighting cache: a 3D texture of half floats, one level (the reference allocates mips and reads
 * level 0 alone, `RayMarchSingleScattering`: `SampleLightingCache(uvw, 0)`), written by the cache pass and read, filtered, by the march. The reference holds it in 11, 11 and
 * 10 bits (four half floats on Metal); a storage texture cannot hold that format here, so it is four
 * half floats everywhere.
 */
export function createLightingCache(
  device: GPUDevice,
  resolution: readonly [number, number, number],
  label: string,
) {
  return device.createTexture({
    label,
    dimension: '3d',
    size: [...resolution],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
}

/** The image of the volumes: radiance in rgb, the transmittance in alpha. */
export function createVolumeImage(
  device: GPUDevice,
  size: readonly [number, number],
  label: string,
  format: GPUTextureFormat = 'rgba16float',
) {
  return device.createTexture({
    label,
    size: [...size],
    format,
    usage:
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  })
}

/** What the words of a volume's uniform are made of, apart from the pass: the settings, the volume and where it is. */
export interface VolumeWordsInputs {
  settings: (field: Parameters<typeof readHeterogeneousVolumeSetting>[1]) => number
  volume: ResolvedHeterogeneousVolume
  toWorld: ArrayLike<number>
  toLocal: ArrayLike<number>
  centre: [number, number, number]
  extent: [number, number, number]
  entry: { resolution: readonly [number, number, number] }
  cacheSize: readonly [number, number, number]
  mode: number
  fogMode: number
  indirectMode: number
  ambientOcclusion: boolean
  holdout: boolean
  existence: boolean
  cameraMap: boolean
}

/** The uniform of a volume for the pass of `light`: the last pass applies the emission and the transmittance, a build of a shadow map
 *  steps by its own size (`Shadows.StepSize`) and the others by the shadow rays'. */
export function volumeWords(c: VolumeWordsInputs, light: number, last: boolean, build: boolean) {
  const { settings, volume, mode } = c
  return packVolume({
    localToWorld: Array.from(c.toWorld),
    worldToLocal: Array.from(c.toLocal),
    boundsOrigin: c.centre,
    boundsExtent: c.extent,
    resolution: c.entry.resolution,
    lightKinds:
      (settings('heterogeneousVolumesLightDirectional') ? 1 : 0) |
      (settings('heterogeneousVolumesLightPoint') ? 2 : 0) |
      (settings('heterogeneousVolumesLightSpot') ? 4 : 0) |
      (settings('heterogeneousVolumesLightRect') ? 8 : 0),
    heightFog: !!settings('heterogeneousVolumesHeightFog'),
    volumetricFog: !!settings('heterogeneousVolumesVolumetricFog'),
    cacheResolution: c.cacheSize,
    shadowBiasFactor: volume.shadowBiasFactor,
    step: [
      settings('heterogeneousVolumesStepSize'),
      volume.stepFactor,
      build
        ? settings('heterogeneousVolumesShadowsStepSize')
        : settings('heterogeneousVolumesShadowStepSize'),
      build ? 1 : volume.shadowStepFactor,
    ],
    limits: [
      settings('heterogeneousVolumesMaxTraceDistance'),
      settings('heterogeneousVolumesMaxShadowTraceDistance'),
      settings('heterogeneousVolumesMaxStepCount'),
      settings('heterogeneousVolumesJitter') ? 1 : 0,
    ],
    flags: [last ? 1 : 0, 1, mode, c.fogMode],
    lightRank: mode === 1 ? light : HV_ALL_LIGHTS,
    indirectMode: c.indirectMode,
    indirectFactor: settings('heterogeneousVolumesIndirectLighting'),
    ambientOcclusion: c.ambientOcclusion,
    holdout: c.holdout,
    existence: c.existence,
    cameraMap: c.cameraMap,
  })
}
