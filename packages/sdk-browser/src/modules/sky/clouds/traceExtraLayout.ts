import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { CLOUD_MATERIAL_OUTPUTS_EMPTY_SPACE } from './traceLayout.ts'

/**
 * THE VIEW TRACING'S OPTIONAL INPUTS, each a static variation of its program as the reference
 * compiles them: the empty-space table, the sun's opaque shadow, the lamps. A variation the frame
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
} as const

/** The variations of the program. */
export interface CloudTracePermutation {
  /** The march starts where the table says the cloud does. */
  readonly emptySpace: boolean
  /** The sun's shadow in the opaque scene's maps lights the cloud. */
  readonly opaqueShadow: boolean
  /** The lamps of the light grid light the cloud. */
  readonly localLights: boolean
}

/** The program with none of them. */
export const CLOUD_TRACE_PLAIN: CloudTracePermutation = {
  emptySpace: false,
  opaqueShadow: false,
  localLights: false,
}

/** What the frame says of the image it traces: a reflection or a capture (no table), the sky
 *  light's capture (no lamps) and whether the sun casts shadows on the clouds. */
export interface CloudTraceFrame {
  readonly reflection: boolean
  readonly skyCapture: boolean
  readonly sunShadowsOnClouds: boolean
}

/** The variations a frame traces with, from the quality settings: the table when the option is on,
 *  the material gives the output and the image is not a reflection; the sun's shadow when the
 *  option is on and the sun casts shadows on the clouds; the lamps when the option is on and the
 *  image is not the sky light's capture. */
export const cloudTracePermutation = (
  quality: Pick<
    SkyQualityValues,
    'cloudEmptySpaceSkipping' | 'cloudSampleLightShadowMap' | 'cloudLocalLights'
  >,
  frame: CloudTraceFrame,
): CloudTracePermutation => ({
  emptySpace:
    quality.cloudEmptySpaceSkipping && CLOUD_MATERIAL_OUTPUTS_EMPTY_SPACE && !frame.reflection,
  opaqueShadow: quality.cloudSampleLightShadowMap && frame.sunShadowsOnClouds,
  localLights: quality.cloudLocalLights && !frame.skyCapture,
})

/** Whether the program binds group 2. */
export const cloudTraceHasExtra = (p: CloudTracePermutation) =>
  p.emptySpace || p.opaqueShadow || p.localLights

/** The layout entries of group 2 for the variations `p`. */
export function cloudTraceExtraLayoutEntries(p: CloudTracePermutation): GPUBindGroupLayoutEntry[] {
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
  ]
}
