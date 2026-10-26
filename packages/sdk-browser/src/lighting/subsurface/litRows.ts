import {
  litProfileRows,
  litTransmissionRows,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/litRows.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { LIGHT_BUFFER_AT } from '../../frame/backend/state/lightBufferLayout.ts'
import { wantsPixelModels } from '../../materials/surface/subsurface.ts'
import { followRegisteredProfiles } from './frame.ts'
import { registeredSubsurfaceProfiles } from './registry.ts'
import { profileHalves } from './table.ts'

const written = new WeakMap<GPUBuffer, number>()

/**
 * THE PROFILES THE LIGHTS READ: at a frame's end of lights, the dual specular of each profile of the table (`litProfileRows`) and its
 * transmission (`litTransmissionRows`) written into the light buffer (`LIGHT_BUFFER_AT.profiles`, `LIGHT_BUFFER_AT.transmissions`) when a surface may wear a shading model of the graph's choice and the profiles
 * are new to the buffer; the profiles the materials name are handed to the view first (`followRegisteredProfiles`). The default skin's row 0 is there before any profile is set.
 */
export function followSubsurfaceProfiles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  buffer: GPUBuffer,
) {
  if (registeredSubsurfaceProfiles().profiles.length === 0 && !wantsPixelModels(rt)) return
  followRegisteredProfiles(rt)
  const state = rt.gpu.subsurface
  const revision = state?.profilesRevision ?? 0
  if (written.get(buffer) === revision) return
  written.set(buffer, revision)
  const halves = profileHalves(
    state?.profiles ?? [],
    revision,
    state?.settings.samplingChannel ?? 1,
  )
  device.queue.writeBuffer(
    buffer,
    LIGHT_BUFFER_AT.profiles,
    litProfileRows(halves) as Float32Array<ArrayBuffer>,
  )
  device.queue.writeBuffer(
    buffer,
    LIGHT_BUFFER_AT.transmissions,
    litTransmissionRows(halves) as Float32Array<ArrayBuffer>,
  )
}
