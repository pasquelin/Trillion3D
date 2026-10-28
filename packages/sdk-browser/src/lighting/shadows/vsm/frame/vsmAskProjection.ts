import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { pickKeyOf } from '../../../../frame/prepare/contractLight.ts'
import { wantsContractLighting } from '../../../../frame/prepare/lit.ts'
import { track } from '../../../deferred/compileLedger.ts'
import { perLightPipelinesOf } from '../projection/perLightPipelines.ts'
import { pipelinesFor } from '../projection/projectionPipelines.ts'
import { shadowsOn } from './vsmGates.ts'

/**
 * At a frame's entry, what the per-light path (`shadowOnePassProjection` false) needs for a shadowed local light, asked off the frame
 * (`PreparedPipeline.ask`) under one guard: a lit image with shadows on and a shadowed local light. The projection's pipeline, and the
 * lit program's per-light pipelines (`LitProgram.perLightReady`) of the program the image will bind (`pickKeyOf`). `perLightPass.ts`
 * `ready()` and `drawLights` would otherwise ask them only at encode, drawing the image that finds the need without the shadowed light
 * and advancing every temporal history. Nothing asked once they are compiled.
 */
export function askPerLightLights(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const res = rt.lights.vsm?.res
  if (
    !res ||
    !wantsContractLighting(rt) ||
    !shadowsOn(rt) ||
    !rt.lights.store.shadowedLocals ||
    readShadowSetting(rt, 'shadowOnePassProjection')
  )
    return
  perLightPipelinesOf(pipelinesFor(device, res.layout)).projection.ask()
  const compiling = rt.gpu.deferred?.askPerLight(pickKeyOf(rt))
  if (compiling) track(device, compiling, true, 'lit program per light')
}
