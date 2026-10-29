import { baseOf, LIGHT_FIELD } from '../../../../sdk-core/src/scene/light/fields.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { noiseViewOn } from '../../gpu/noise/blueNoiseTextures.ts'
import { boundingSphere, type ShadowLight } from './beerShadowMapGpu.ts'
import type { FrameContext } from './liveShadingContext.ts'
import { avsmSettingsOf } from './liveShadingAvsm.ts'
import { bufferOf } from './liveShadingState.ts'
import {
  beerFaceBasis,
  orthographicShadowToWorld,
  perspectiveShadowToWorld,
} from './volumetricShadow/shadowFaceMatrix.ts'
import { avsmListBytes } from './volumetricShadow/avsmBlockPlan.ts'
import {
  encodeConvertVolumetricToBeer,
  encodeRenderVolumetricShadowMap,
  packRenderParams,
} from './volumetricShadow/volumetricShadowEncode.ts'
import {
  volumetricShadowPassesOf,
  type BeerFormat,
} from './volumetricShadow/volumetricShadowPasses.ts'
import { encodeFrustumGrid, type FrustumGrid } from './voxelGrid/frustumGridBuild.ts'
import { STORAGE, UNIFORM } from './voxelGrid/bufferUsage.ts'
import { VG_GRID_PARAMS_BYTES } from './voxelGrid/gridEvalWgsl.ts'
import { gridParamsOf } from './voxelGrid/gridParamsOf.ts'
import { VG_PARAMS_STRIDE, voxelGridPassesOf } from './voxelGrid/gridPasses.ts'
import { encodeOrthoGrid, type OrthoGrid } from './voxelGrid/orthoGridBuild.ts'
import type { GridBuildEnvironment } from './voxelGrid/gridRasterize.ts'
import {
  frustumSettingsOf,
  orthoSettingsOf,
  SHADOW_GRID_BUILD,
  shadowGridOptionsOf,
} from './voxelGridSettings.ts'
import { gridSourcesOf } from './voxelGridSources.ts'
import { gridViewOf } from './voxelGridView.ts'

/** The voxel grids an image built, for the passes after it (the shadow maps rendered through them, the diagnostic view of their transmittance). */
export interface VoxelGrids {
  readonly ortho?: OrthoGrid
  readonly frustum?: FrustumGrid
}

/** What the passes that build the grids ask of the frame (`GridBuildEnvironment`). */
export function gridEnvironmentOf(c: FrameContext): GridBuildEnvironment {
  const { device, held } = c
  return {
    device,
    encoder: c.encoder,
    passes: voxelGridPassesOf(device),
    bufferOf: (key, size, usage) => bufferOf(held, device, key, size, usage),
    noiseView: noiseViewOn(device),
    maxBinding: device.limits.maxStorageBufferBindingSize,
    mostGroups: device.limits.maxComputeWorkgroupsPerDimension,
  }
}

/**
 * The grids of the volumes of the image built (`FDeferredShadingSceneRenderer::RenderHeterogeneousVolumeShadows`, `HeterogeneousVolumes.cpp:995-1007`): the
 * ortho grid always, the frustum grid where the build asks for it (the shadows' does not), none where the volumes are not ready or meet no view.
 */
export function encodeVoxelGrids(c: FrameContext): VoxelGrids {
  const sources = gridSourcesOf(c)
  if (!sources) return {}
  const env = gridEnvironmentOf(c)
  const { view, orthographic, outwardPlanes } = gridViewOf(c)
  const shared = {
    ...env,
    view,
    sources,
    options: shadowGridOptionsOf(c.settings),
    frame: noiseFrame(c.rt) % 8,
  }
  const jitter = !!c.settings('heterogeneousVolumesShadowsJitter')
  const ortho =
    c.settings('heterogeneousVolumesOrthoGrid') && SHADOW_GRID_BUILD.orthoGrid
      ? encodeOrthoGrid({
          ...shared,
          orthographic,
          planes: outwardPlanes,
          settings: orthoSettingsOf(c.settings),
          jitter,
        })
      : undefined
  const frustum =
    c.settings('heterogeneousVolumesFrustumGrid') && SHADOW_GRID_BUILD.frustumGrid
      ? encodeFrustumGrid({ ...shared, settings: frustumSettingsOf(c.settings), jitter })
      : undefined
  return { ortho, frustum }
}

/** A light's place and direction as the light buffer holds them. */
function lightOf(c: FrameContext, rank: number) {
  const packed = c.rt.lights.store.packed
  const at = baseOf(rank)
  const read = (field: number) =>
    [packed[at + field], packed[at + field + 1], packed[at + field + 2]] as const
  return { position: read(LIGHT_FIELD.position), direction: read(LIGHT_FIELD.direction) }
}

/** The debug strip the render of a map writes the transmittance of one face to (`ShadowDebugTweak`): a texture of the map's format, kept by size. */
function debugStripOf(c: FrameContext, resolution: number) {
  const key = `grid shadow debug ${c.beerFormat} ${resolution}`
  let texture = c.held.caches.get(key)
  if (!texture) {
    for (const [other, old] of c.held.caches)
      if (other.startsWith('grid shadow debug ')) (old.destroy(), c.held.caches.delete(other))
    texture = c.device.createTexture({
      label: 'Trillion3D heterogeneous volume grid shadow debug',
      size: [resolution, resolution],
      format: c.beerFormat,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    c.held.caches.set(key, texture)
  }
  return texture.createView()
}

/**
 * The volumetric shadow map of a light rendered through the grids (`RenderVolumetricShadowMapForLightWithVoxelGrid`): a list of samples a texel of each
 * face, the face's rays those of the light's Beer map (`beerFaceBasis`: the same texels, the same distances), started `ShadowsNearClippingDistance`
 * from a local light and marched through the grids. The lists are what the adaptive map is compressed from, or, for the beer map, what its first and
 * last sample make a texel of (`ConvertVolumetricShadowMapToBeerLawShadowMap`).
 */
function encodeLightMap(c: FrameContext, light: ShadowLight, grids: VoxelGrids, mostBytes: number) {
  const { device, held, settings, shadow, encoder } = c
  const { resolution } = shadow
  const avsm = avsmSettingsOf(settings)
  const bytes = avsmListBytes(resolution, light.faces, avsm.maxSampleCount)
  if (bytes > device.limits.maxStorageBufferBindingSize) return
  const sphere = boundingSphere(c.placed)
  const { position, direction } = lightOf(c, light.rank)
  const near = settings('heterogeneousVolumesShadowsNearClippingDistance')
  const shadowToWorld = Array.from({ length: light.faces }, (_, face) => {
    const basis = beerFaceBasis(
      { directional: light.directional, position, direction },
      face,
      sphere,
    )
    return light.directional
      ? orthographicShadowToWorld(basis, sphere[3], 2 * sphere[3])
      : perspectiveShadowToWorld(
          basis,
          [1, 1],
          near,
          settings('heterogeneousVolumesMaxTraceDistance'),
        )
  })
  const lists = shadow.adaptive
    ? bufferOf(held, device, `avsm ${light.rank} list 0`, bytes, STORAGE)
    : bufferOf(held, device, 'grid shadow lists', mostBytes, STORAGE)
  const stand = bufferOf(held, device, 'grid stand-in', 16, STORAGE)
  const format: BeerFormat = c.beerFormat === 'rgba32float' ? 'rgba32float' : 'rgba16float'
  const passes = volumetricShadowPassesOf(device, format)
  encodeRenderVolumetricShadowMap({
    device,
    encoder,
    passes,
    kind: 'light',
    resolution: [resolution, resolution],
    faces: light.faces,
    params: packRenderParams({
      resolution: [resolution, resolution],
      maxSampleCount: avsm.maxSampleCount,
      jitter: !!settings('heterogeneousVolumesJitter'),
      stepSize: settings('heterogeneousVolumesShadowsStepSize'),
      maxStepCount: settings('heterogeneousVolumesMaxStepCount'),
      debugTweak: settings('heterogeneousVolumesShadowsDebugTweak'),
      frameIndexMod8: noiseFrame(c.rt) % 8,
      absoluteError: avsm.absoluteError,
      relativeError: avsm.relativeError,
      compress: avsm.compress,
      // The rays go through the texels' centres, as the beer map's do (the reference starts them at the texels' corners, and moves them by the temporal jitter).
      temporalJitter: [0.5, 0.5],
      distanceFrom: light.directional ? undefined : position,
      shadowToWorld,
    }),
    gridParams: gridParamsOf(grids.ortho, grids.frustum),
    uniform: bufferOf(
      held,
      device,
      `grid shadow parameters ${light.rank}`,
      VG_PARAMS_STRIDE,
      UNIFORM,
    ),
    gridUniform: bufferOf(held, device, 'grid shadow grids', VG_GRID_PARAMS_BYTES, UNIFORM),
    storage: [
      grids.ortho?.topLevel ?? stand,
      grids.ortho?.indirectionGrid ?? stand,
      grids.ortho?.extinction ?? stand,
      grids.frustum?.topLevel ?? stand,
      grids.frustum?.extinction ?? stand,
    ],
    lists,
    allocator: bufferOf(held, device, 'grid shadow allocator', 4, STORAGE),
    debugView: debugStripOf(c, resolution),
    noiseView: noiseViewOn(device),
  })
  if (!shadow.adaptive)
    encodeConvertVolumetricToBeer({
      device,
      encoder,
      passes,
      beerView: shadow
        .imageOf(`beer ${light.rank} 0`, [resolution * light.faces, resolution])
        .createView(),
      resolution: [resolution, resolution],
      faces: light.faces,
      maxSampleCount: avsm.maxSampleCount,
      lists,
      uniform: bufferOf(
        held,
        device,
        `grid shadow convert ${light.rank}`,
        VG_PARAMS_STRIDE,
        UNIFORM,
      ),
      clear: false,
    })
  shadow.built.set(light.rank, 1)
}

/**
 * The shadows phase through the voxel grids (`HeterogeneousVolumes.cpp:985-1076`): the grids built, then, where the volumes cast shadows, the map of every
 * light that has one rendered through them and kept in the map the setting names. The grids are kept for the diagnostic view of their transmittance.
 */
export function encodeVoxelGridShadows(c: FrameContext) {
  const grids = encodeVoxelGrids(c)
  c.held.voxelGrids = grids
  if (!c.settings('heterogeneousVolumesShadows') || !(grids.ortho || grids.frustum)) return
  // One list buffer serves every light in turn, large enough for the largest.
  const avsm = avsmSettingsOf(c.settings)
  const mostBytes = Math.max(
    ...c.shadow.lights.map((light) =>
      avsmListBytes(c.shadow.resolution, light.faces, avsm.maxSampleCount),
    ),
  )
  for (const light of c.shadow.lights) encodeLightMap(c, light, grids, mostBytes)
}
