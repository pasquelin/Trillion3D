import { cloudHazeInSecondPass } from './traceOptions.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import type { CloudMaterial } from '../../../../../sdk-core/src/modules/sky/cloudMaterial.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import type { AirShadowMaps } from '../../../lighting/atmosphere/bindings.ts'
import {
  cloudShadowBindEntries,
  cloudShadowLayoutEntries,
  type CloudShadowBindings,
  type CloudShadowSet,
} from '../../../lighting/atmosphere/cloudShadowRead.ts'
import {
  skyLightDiffuseBindEntries,
  skyLightDiffuseLayoutEntries,
  type SkyLightDiffuseBindings,
  type SkyLightReadSet,
} from '../skyLight/read.ts'
import { CAPTURE_CLOUD_SETUP, type CloudSetup } from './cloudModes.ts'

/**
 * THE VIEW TRACING'S OPTIONAL INPUTS, each a static variation of its program as the reference
 * compiles them: the empty-space table, the sun's opaque shadow, the lamps, the sky light's
 * harmonics (a scene with no air), the clouds' shadow maps (the material's own shade read, not
 * marched). A variation the frame
 * does not ask for is not compiled and binds nothing, so the plain program is the one of
 * `traceWgsl.ts` alone; the ones asked for bind their inputs in group 2, in this order of numbers.
 */
export const CLOUD_TRACE_EXTRA_GROUP = 2

export const CLOUD_TRACE_EXTRA_BINDING = {
  /** The empty-space table (`emptySpace.ts`), read by load. */
  startDistance: 0,
  /** The shadow maps' page table, projection data, uniforms and pool, as a blend pass samples
   *  them (`vsmConsumerResources`), and the projection's view. */
  vsm: { pageTable: 1, projectionData: 2, uniforms: 3, pool: 4 },
  vsmView: 5,
  /** The view's light grid: the lists of lamps of its cells (`lightGrid.ts`). */
  tileLights: 6,
  /** The sky light's harmonics and its read uniform (`SkyLightDiffuseBindings`). */
  skyHarmonics: 7,
  skyParams: 8,
  /** The clouds' shadow maps' block, the two maps and their sampler (`CLOUD_TRACE_SHADOW_MAPS`). */
  cloudShadowBlock: 9,
  cloudShadowMap0: 10,
  cloudShadowMap1: 11,
  cloudShadowSampler: 12,
} as const

/** Where the tracing reads the clouds' shadow maps, in group 2, through a sampler of their own. */
export const CLOUD_TRACE_SHADOW_MAPS: CloudShadowBindings = {
  group: CLOUD_TRACE_EXTRA_GROUP,
  block: CLOUD_TRACE_EXTRA_BINDING.cloudShadowBlock,
  map0: CLOUD_TRACE_EXTRA_BINDING.cloudShadowMap0,
  map1: CLOUD_TRACE_EXTRA_BINDING.cloudShadowMap1,
  sampler: CLOUD_TRACE_EXTRA_BINDING.cloudShadowSampler,
}

/** Where the tracing reads the sky light's diffuse light, in group 2. */
export const CLOUD_TRACE_SKY_LIGHT: SkyLightDiffuseBindings = {
  group: CLOUD_TRACE_EXTRA_GROUP,
  harmonics: CLOUD_TRACE_EXTRA_BINDING.skyHarmonics,
  params: CLOUD_TRACE_EXTRA_BINDING.skyParams,
}

/** What makes one program of the view tracing: the scene's depth it reads and whether it traces two
 *  surfaces (the setup's), and the variations of its options. One program, one layout and one
 *  pipeline are made for each key. */
export interface CloudTraceKey extends Pick<CloudSetup, 'depth' | 'minMaxDepth'> {
  /** The march starts where the table says the cloud does. */
  readonly emptySpace: boolean
  /** The sun's shadow in the opaque scene's maps lights the cloud. */
  readonly opaqueShadow: boolean
  /** The lamps of the light grid light the cloud. */
  readonly localLights: boolean
  /** The distant sky light that lights the cloud is the sky light's own diffuse light, read from
   *  its harmonics: the scene has no air to give it (`CloudTraceFrame.airless`). */
  readonly skyLight: boolean
  /** The cloud's own shade is read from the clouds' shadow maps, no ray marched toward the lights
   *  (the material's `rayMarchVolumeShadow` off). */
  readonly volumeShadowMap: boolean
  /** The haze is laid in a second pass over two surfaces (`cloudHazeInSecondPass`): the trace
   *  writes the closest surface's depth beside its colour, which the second surface is hazed at. */
  readonly closestDepth: boolean
}

/** What the frame says of the image it traces: a reflection or a capture (no table), the sky
 *  light's capture (no lamps), whether the sun casts shadows on the clouds, and whether the scene
 *  has no air. */
export interface CloudTraceFrame {
  readonly reflection: boolean
  readonly skyCapture: boolean
  readonly sunShadowsOnClouds: boolean
  readonly airless: boolean
}

/** The key a frame traces with, from the quality settings and the setup (its depth source and its
 *  two surfaces): the table when the option is on and the image is not a reflection; the sun's shadow when the
 *  option is on and the sun casts shadows on the clouds; the lamps when the option is on and the
 *  image is not the sky light's capture; the sky light's harmonics when the distant sky light is on
 *  and the scene has no air; the clouds' shadow maps when the material does not march its shadow. */
export const cloudTraceKey = (
  quality: Pick<
    SkyQualityValues,
    | 'cloudEmptySpaceSkipping'
    | 'cloudSampleLightShadowMap'
    | 'cloudLocalLights'
    | 'cloudDistantSkyLight'
    | 'cloudHighQualityAerial'
    | 'cloudAerialPerspective'
  >,
  frame: CloudTraceFrame,
  setup: CloudSetup,
  material: Pick<CloudMaterial, 'rayMarchVolumeShadow'>,
): CloudTraceKey => ({
  depth: setup.depth,
  minMaxDepth: setup.minMaxDepth,
  emptySpace: quality.cloudEmptySpaceSkipping && !frame.reflection,
  opaqueShadow: quality.cloudSampleLightShadowMap && frame.sunShadowsOnClouds,
  localLights: quality.cloudLocalLights && !frame.skyCapture,
  skyLight: quality.cloudDistantSkyLight && frame.airless,
  volumeShadowMap: !material.rayMarchVolumeShadow,
  closestDepth:
    setup.minMaxDepth && !frame.skyCapture && cloudHazeInSecondPass(quality, !frame.airless),
})

/** The key the sky light's capture traces with: the capture setup's depth source, no empty-space
 *  table and no lamps (a reflection), the sun's shadow where the capture reads the opaque scene's
 *  (`shadowed`) and the sky light's harmonics where the scene has no air (`airless`). */
export const captureCloudKey = (
  quality: Parameters<typeof cloudTraceKey>[0],
  shadowed: boolean,
  airless: boolean,
  material: Parameters<typeof cloudTraceKey>[3],
): CloudTraceKey =>
  cloudTraceKey(
    quality,
    { reflection: true, skyCapture: true, sunShadowsOnClouds: shadowed, airless },
    CAPTURE_CLOUD_SETUP,
    material,
  )

/** The key as text, to keep what is made for it. */
export const cloudTraceKeyText = (k: CloudTraceKey) =>
  [
    ...[k.depth, k.minMaxDepth, k.emptySpace, k.opaqueShadow, k.localLights, k.skyLight],
    k.volumeShadowMap,
    k.closestDepth,
  ].join('|')

/** Whether the program binds group 2. */
export const cloudTraceHasExtra = (p: CloudTraceKey) =>
  p.emptySpace || p.opaqueShadow || p.localLights || p.skyLight || p.volumeShadowMap

/** The layout entries of group 2 for the variations `p`. */
export function cloudTraceExtraLayoutEntries(p: CloudTraceKey): GPUBindGroupLayoutEntry[] {
  const b = CLOUD_TRACE_EXTRA_BINDING
  return [
    ...(p.emptySpace ? [computeTextureEntry(b.startDistance, 'unfilterable-float')] : []),
    ...(p.opaqueShadow
      ? [
          computeBufferEntry(b.vsm.pageTable, 'read-only-storage'),
          computeBufferEntry(b.vsm.projectionData, 'read-only-storage'),
          computeUniformEntry(b.vsm.uniforms),
          computeBufferEntry(b.vsm.pool, 'read-only-storage'),
          computeUniformEntry(b.vsmView),
        ]
      : []),
    ...(p.localLights ? [computeBufferEntry(b.tileLights, 'read-only-storage')] : []),
    ...(p.skyLight ? skyLightDiffuseLayoutEntries(CLOUD_TRACE_SKY_LIGHT, COMPUTE) : []),
    ...(p.volumeShadowMap ? cloudShadowLayoutEntries(CLOUD_TRACE_SHADOW_MAPS, COMPUTE) : []),
  ]
}

/** What the options of the tracing read beyond the air: the virtual shadow maps' tables, bound
 *  where the sun's opaque shadow is read, the light grid's lists, where the lamps light the cloud,
 *  the sky light's harmonics, where the scene has no air, and the clouds' shadow maps (or their
 *  stand-in), where the material's shade is read from them, and the empty-space table, where the
 *  march starts where it says. */
export interface CloudTraceInputs {
  readonly startDistance?: GPUTextureView
  readonly maps?: AirShadowMaps
  readonly tileLights?: GPUBuffer
  readonly skyLight?: SkyLightReadSet
  readonly cloudShadow?: CloudShadowSet
}

/** The resources of `inputs` a group 2 is kept for. */
export const cloudTraceExtraHeld = ({
  startDistance,
  maps,
  tileLights,
  skyLight,
  cloudShadow,
}: CloudTraceInputs) => [
  startDistance,
  ...[maps?.pageTable, maps?.projectionData, maps?.uniforms, maps?.pool, maps?.view],
  tileLights,
  skyLight?.harmonics,
  skyLight?.params,
  ...[cloudShadow?.block, cloudShadow?.maps[0], cloudShadow?.maps[1], cloudShadow?.sampler],
]

/** The entries of group 2 for the variations `p`, of `inputs`. */
export function cloudTraceExtraEntries(
  p: CloudTraceKey,
  { startDistance, maps, tileLights, skyLight, cloudShadow }: CloudTraceInputs,
): GPUBindGroupEntry[] {
  const b = CLOUD_TRACE_EXTRA_BINDING
  return [
    ...(p.emptySpace && startDistance
      ? [{ binding: b.startDistance, resource: startDistance }]
      : []),
    ...(p.opaqueShadow && maps
      ? [
          { binding: b.vsm.pageTable, resource: { buffer: maps.pageTable } },
          { binding: b.vsm.projectionData, resource: { buffer: maps.projectionData } },
          { binding: b.vsm.uniforms, resource: { buffer: maps.uniforms } },
          { binding: b.vsm.pool, resource: { buffer: maps.pool } },
          { binding: b.vsmView, resource: { buffer: maps.view } },
        ]
      : []),
    ...(p.localLights && tileLights
      ? [{ binding: b.tileLights, resource: { buffer: tileLights } }]
      : []),
    ...(p.skyLight && skyLight ? skyLightDiffuseBindEntries(CLOUD_TRACE_SKY_LIGHT, skyLight) : []),
    ...(p.volumeShadowMap && cloudShadow
      ? cloudShadowBindEntries(CLOUD_TRACE_SHADOW_MAPS, cloudShadow)
      : []),
  ]
}
