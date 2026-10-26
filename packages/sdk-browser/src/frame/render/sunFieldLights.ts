import { normalizeVector3OrZero } from '../../../../math/src/vector/vector.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { DFSH_MAX_LIGHTS } from '../../lighting/distanceField/shadow/layout.ts'
import type { DfshLight } from '../../lighting/distanceField/shadow/params.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The suns the cascade is traced for, rewritten by each image (`sunsOf`). */
export const lights: DfshLight[] = []

const direction: [number, number, number] = [0, 0, 0]

/**
 * The suns of the frame whose distance-field cascade is traced, into `lights`: the first four of
 * the frame's shadowed lights, each by the channel of its shadow maps (`vsmPlanSteps.ts`, its lane
 * of the mask), that have a cascade (`sunCascades`).
 */
export function sunsOf(rt: WebgpuPagesRuntime) {
  lights.length = 0
  const plan = rt.lights.vsm?.plan
  if (!plan) return lights
  for (let lane = 0; lane < Math.min(plan.projected.length, DFSH_MAX_LIGHTS); lane++) {
    const sun = plan.projected[lane].clipmap?.light
    const cascade = sun?.cascades?.distanceField
    if (!sun || !cascade || !sun.shadow) continue
    normalizeVector3OrZero(direction, sun.direction, 1e-12)
    lights.push({
      lane,
      toLight: [-direction[0], -direction[1], -direction[2]],
      // 0 is the hard shadow a light asks for (the maps trace a point), not the default disk.
      angularRadius:
        rt.lights.store.light(sun.id)?.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius,
      cascade,
      traceDistance: sun.shadow.distanceFieldTraceDistance,
      rayStartOffset: sun.shadow.distanceFieldRayStartOffset,
      amount: sun.shadow.shadowAmount,
    })
  }
  return lights
}
