import { readSingleLayerWaterSetting } from '../../../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { waterWanted } from '../../../../blend/water/waterTargets.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'

/**
 * Whether the water of this image will ask for the cascade's run (`forwardFieldSun`): it is drawn, its programs hold the distance-field shadow, the switch is on
 * and the scene has fields. Known before the water is opened, so the image the water first appears in is traced too, and the run does not depend on a held view.
 */
export const waterWantsField = (rt: WebgpuPagesRuntime) =>
  !!rt.distanceFields &&
  !!waterWanted(rt) &&
  readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportDistanceFieldShadow') &&
  readSingleLayerWaterSetting(rt, 'singleLayerWaterDistanceFieldShadow')
