import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { SCENE_ENVIRONMENT_FLOATS } from '../../../../../sdk-core/src/scene/core/environment.ts'
import { SKY_FLOATS } from '../../../../../sdk-core/src/scene/core/environmentSky.ts'
import { ATMOSPHERE_REGION_BYTES } from '../../../lighting/atmosphere/layout.ts'
import { LTC_SIZE } from '../../../../../sdk-core/src/lighting/ltcTable.ts'

/** Bytes before the light slots (`DirectLights`): the header, the environment's irradiance and fog,
 *  the sky's block, the atmosphere's four regions (`../../../lighting/atmosphere/layout.ts`), then
 *  the fitted lobe of the rectangles, two `vec4f` per cell. */
export const HEAD_BYTES = SCENE_LIGHT_HEADER_FLOATS * 4
const SKY_BYTES_AT = HEAD_BYTES + SCENE_ENVIRONMENT_FLOATS * 4,
  ATMOSPHERE_BYTES_AT = SKY_BYTES_AT + SKY_FLOATS * 4,
  LTC_BYTES = ATMOSPHERE_BYTES_AT + ATMOSPHERE_REGION_BYTES
/** Where each region of the buffer starts, in bytes: the sky's block, the atmosphere's regions, the
 *  rectangles' lobe, then the light slots. */
export const LIGHT_BUFFER_AT = {
  sky: SKY_BYTES_AT,
  atmosphere: ATMOSPHERE_BYTES_AT,
  ltc: LTC_BYTES,
  items: LTC_BYTES + LTC_SIZE * LTC_SIZE * 32,
} as const
