// The heterogeneous volumes' contract: the reference component's defaults, the refusals, the store
// and the animation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HETEROGENEOUS_VOLUME_RULES } from '../../contracts/heterogeneousVolumeOptions.ts'
import { resolveSettings } from '../../contracts/settingRules.ts'
import { heterogeneousVolumeBounds, resolveHeterogeneousVolume } from './contracts.ts'
import { advanceHeterogeneousVolumeFrame } from './playback.ts'
import { createSceneHeterogeneousVolumeStore } from './store.ts'

test('a volume that names only its source takes the reference component defaults', () => {
  const volume = resolveHeterogeneousVolume({ id: 'smoke', source: 3 })
  assert.deepEqual(
    { ...volume, matrix: undefined },
    {
      id: 'smoke',
      source: 3,
      matrix: undefined,
      frame: 0,
      frameRate: 24,
      startFrame: 0,
      endFrame: undefined,
      playing: false,
      looping: false,
      streamingMipBias: 0,
      blockingRequests: false,
      pivotAtCentroid: false,
      stepFactor: 1,
      shadowStepFactor: 2,
      shadowBiasFactor: 0.5,
      lightingDownsampleFactor: 2,
      castShadow: true,
      visible: true,
      holdout: false,
    },
  )
  assert.equal(volume.matrix.length, 16)
})

test('a field that is not what the contract takes is refused by name', () => {
  const refused = (patch: object, field: string) =>
    assert.throws(() => resolveHeterogeneousVolume({ id: 'a', source: 0, ...patch }), {
      code: 'INVALID_SCENE_HETEROGENEOUS_VOLUME',
      message: new RegExp(field),
    })
  refused({ source: -1 }, 'source')
  refused({ matrix: [1, 2] }, 'matrix')
  refused({ frame: -1 }, 'frame')
  refused({ endFrame: 1, startFrame: 2 }, 'endFrame')
  refused({ stepFactor: 0 }, 'stepFactor')
  refused({ lightingDownsampleFactor: 0.5 }, 'lightingDownsampleFactor')
  refused({ playing: 1 }, 'playing')
  assert.throws(() => resolveHeterogeneousVolume({ id: '', source: 0 }), {
    code: 'INVALID_SCENE_HETEROGENEOUS_VOLUME',
  })
})

test('the store refuses a duplicate and an unknown name and counts a change once', () => {
  const store = createSceneHeterogeneousVolumeStore()
  store.add({ id: 'a', source: 1 })
  assert.throws(() => store.add({ id: 'a', source: 1 }), {
    code: 'DUPLICATE_SCENE_HETEROGENEOUS_VOLUME',
  })
  const revision = store.revision
  store.set('a', { source: 1 })
  assert.equal(store.revision, revision)
  store.set('a', { playing: true })
  assert.equal(store.revision, revision + 1)
  assert.throws(() => store.remove('b'), { code: 'UNKNOWN_SCENE_HETEROGENEOUS_VOLUME' })
})

test('the bounds are the voxels from the corner, or around the centre', () => {
  assert.deepEqual(heterogeneousVolumeBounds([4, 6, 8], false), {
    min: [0, 0, 0],
    max: [4, 6, 8],
  })
  assert.deepEqual(heterogeneousVolumeBounds([4, 6, 8], true), {
    min: [-2, -3, -4],
    max: [2, 3, 4],
  })
})

test('a playing volume advances by the frame rate, loops or stays within its frames', () => {
  const at = (patch: object) => resolveHeterogeneousVolume({ id: 'a', source: 0, ...patch })
  assert.equal(advanceHeterogeneousVolumeFrame(at({ frame: 2 }), 10, 1), 2)
  assert.equal(advanceHeterogeneousVolumeFrame(at({ frame: 2, playing: true }), 10, 0.25), 8)
  assert.equal(advanceHeterogeneousVolumeFrame(at({ frame: 2, playing: true }), 10, 1), 9)
  assert.equal(
    advanceHeterogeneousVolumeFrame(at({ frame: 8, playing: true, looping: true }), 10, 0.25),
    4,
  )
})

test('the settings default to the reference cvars', () => {
  assert.deepEqual(resolveSettings(HETEROGENEOUS_VOLUME_RULES, {}), {
    heterogeneousVolumes: true,
    heterogeneousVolumesAllowed: true,
    heterogeneousVolumesShadows: false,
    heterogeneousVolumesShadowsResolution: 512,
    heterogeneousVolumesShadowsPrecision: 0,
    heterogeneousVolumesShadowsNearClippingDistance: 1,
    heterogeneousVolumesShadowsStepSize: 2,
    heterogeneousVolumesTranslucency: false,
    heterogeneousVolumesVelocity: false,
    heterogeneousVolumesComposition: 0,
    heterogeneousVolumesDownsampleFactor: 1,
    heterogeneousVolumesJitter: true,
    heterogeneousVolumesMaxStepCount: 512,
    heterogeneousVolumesStepSize: -1,
    heterogeneousVolumesShadowStepSize: -1,
    heterogeneousVolumesMaxTraceDistance: 30000,
    heterogeneousVolumesMaxShadowTraceDistance: 30000,
    heterogeneousVolumesLightingCache: 2,
    heterogeneousVolumesLightingCacheDownsampleFactor: 0,
    heterogeneousVolumesDepthSort: true,
    heterogeneousVolumesHeightFog: true,
    heterogeneousVolumesVolumetricFog: true,
    heterogeneousVolumesFogInscattering: 2,
    heterogeneousVolumesIndirectLightingMode: 0,
    heterogeneousVolumesIndirectLighting: 0,
    heterogeneousVolumesScalability: 3,
    heterogeneousVolumesUseExistenceMask: true,
    heterogeneousVolumesAmbientOcclusion: false,
    heterogeneousVolumesAmbientOcclusionDownsampleFactor: 4,
    heterogeneousVolumesAmbientOcclusionRayCountX: 4,
    heterogeneousVolumesAmbientOcclusionRayCountY: 4,
    heterogeneousVolumesAmbientOcclusionMaxTraceDistance: 1000,
    heterogeneousVolumesAmbientOcclusionMaxStepCount: 64,
    heterogeneousVolumesPreshading: false,
    heterogeneousVolumesPreshadingMipLevel: 0,
    heterogeneousVolumesPreshadingPixelFormat: 2,
    heterogeneousVolumesPreshadingCLOD: 1,
    heterogeneousVolumesCLOD: true,
    heterogeneousVolumesCLODBias: 0,
    heterogeneousVolumesVolumeResolutionX: 0,
    heterogeneousVolumesVolumeResolutionY: 0,
    heterogeneousVolumesVolumeResolutionZ: 0,
    heterogeneousVolumesLightDirectional: true,
    heterogeneousVolumesLightPoint: true,
    heterogeneousVolumesLightSpot: true,
    heterogeneousVolumesLightRect: true,
    heterogeneousVolumesUpsample: 2,
    heterogeneousVolumesFilter: 2,
    heterogeneousVolumesFilterWidth: 3,
    heterogeneousVolumesShadowsPipeline: 0,
    heterogeneousVolumesFrustumGrid: true,
    heterogeneousVolumesFrustumGridShadingRate: 4,
    heterogeneousVolumesFrustumGridNearPlaneDistance: 1,
    heterogeneousVolumesFrustumGridFarPlaneDistance: -1,
    heterogeneousVolumesFrustumGridDepthSliceCount: 512,
    heterogeneousVolumesOrthoGrid: true,
    heterogeneousVolumesOrthoGridShadingRate: 4,
    heterogeneousVolumesBottomLevelGridResolution: 4,
    heterogeneousVolumesIndirectionGrid: true,
    heterogeneousVolumesIndirectionGridResolution: 4,
    heterogeneousVolumesMinimumVoxelSizeInFrustum: 0.1,
    heterogeneousVolumesMinimumVoxelSizeOutsideFrustum: 100,
    heterogeneousVolumesFarPlaneAutoTransition: true,
    heterogeneousVolumesTopLevelBitmask: false,
    heterogeneousVolumesMajorantGrid: true,
    heterogeneousVolumesMajorantGridMax: false,
    heterogeneousVolumesSparseVoxel: false,
    heterogeneousVolumesSparseVoxelGenerationMipBias: 0,
    heterogeneousVolumesSparseVoxelPerTileCulling: false,
    heterogeneousVolumesSparseVoxelRefinement: false,
    heterogeneousVolumesShadowsCameraDownsampleFactor: 2,
    heterogeneousVolumesShadowsMaxSampleCount: 8,
    heterogeneousVolumesShadowsAbsoluteErrorThreshold: 0,
    heterogeneousVolumesShadowsRelativeErrorThreshold: 0.05,
    heterogeneousVolumesShadowsUseAvsmCompression: true,
    heterogeneousVolumesShadowsDebugTweak: 0,
    heterogeneousVolumesShadowsShadingRate: 1,
    heterogeneousVolumesShadowsOutOfFrustumShadingRate: 2,
    heterogeneousVolumesShadowsJitter: false,
    heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes: 128,
    heterogeneousVolumesFrustumGridMaxBottomLevelMemoryInMegabytes: 128,
    heterogeneousVolumesBottomLevelGridHomogeneousAggregation: true,
    heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold: 0.001,
    heterogeneousVolumesShadowsLightDirectional: true,
    heterogeneousVolumesShadowsLightPoint: true,
    heterogeneousVolumesShadowsLightSpot: true,
    heterogeneousVolumesShadowsLightRect: true,
    heterogeneousVolumesDebug: 0,
    heterogeneousVolumesShadowsType: 1,
    heterogeneousVolumesHardwareRayTracing: false,
  })
  assert.throws(() =>
    resolveSettings(HETEROGENEOUS_VOLUME_RULES, { heterogeneousVolumes: 2 as never }),
  )
  assert.throws(() =>
    resolveSettings(HETEROGENEOUS_VOLUME_RULES, { heterogeneousVolumesDownsampleFactor: 9 }),
  )
})
