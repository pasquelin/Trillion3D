import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { SCENE_ENVIRONMENT_FLOATS } from '../../../../../sdk-core/src/scene/core/environment.ts'
import { ATMOSPHERE_REGION_BYTES, FOG_VIEW_REGION_AT } from '../../../lighting/atmosphere/layout.ts'
import { LTC_SIZE } from '../../../../../sdk-core/src/lighting/ltcTable.ts'

/** Bytes before the light slots (`DirectLights`): the header, the environment's irradiance and fog,
 *  the atmosphere's four regions (`../../../lighting/atmosphere/layout.ts`), then
 *  the fitted lobe of the rectangles, two `vec4f` per cell. */
export const HEAD_BYTES = SCENE_LIGHT_HEADER_FLOATS * 4
const ATMOSPHERE_BYTES_AT = HEAD_BYTES + SCENE_ENVIRONMENT_FLOATS * 4,
  LTC_BYTES = ATMOSPHERE_BYTES_AT + ATMOSPHERE_REGION_BYTES
/** Where each region of the buffer starts, in bytes: the atmosphere's regions, the
 *  fog volume's view block, the rectangles' lobe, then the light slots. */
export const LIGHT_BUFFER_AT = {
  atmosphere: ATMOSPHERE_BYTES_AT,
  /** The fog volume's view block, which the CPU writes each image its volume is built. */
  fogView: ATMOSPHERE_BYTES_AT + FOG_VIEW_REGION_AT,
  ltc: LTC_BYTES,
  items: LTC_BYTES + LTC_SIZE * LTC_SIZE * 32,
} as const
