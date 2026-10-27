import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { SCENE_ENVIRONMENT_FLOATS } from '../../../../../sdk-core/src/scene/core/environment.ts'
import {
  ATMOSPHERE_REGION_BYTES,
  FOG_VIEW_REGION_AT,
  LOCAL_FOG_REGION_AT,
} from '../../../lighting/atmosphere/layout.ts'
import { LTC_SIZE } from '../../../../../sdk-core/src/lighting/ltcTable.ts'
import {
  LIT_PROFILE_ROWS,
  LIT_TRANSMISSION_VEC4S,
} from '../../../../../sdk-core/src/lighting/subsurfaceProfile/litRows.ts'
import { ENV_BRDF_TEXELS } from '../../../../../sdk-core/src/lighting/environmentBrdf.ts'
import { SKIN_TABLE_TEXELS } from '../../../../../sdk-core/src/lighting/skinTable.ts'
import { SHEEN_LTC_SIZE } from '../../../../../sdk-core/src/lighting/sheenLtc.ts'

/** Bytes before the light slots (`DirectLights`): the header, the environment's irradiance and fog,
 *  the atmosphere's regions and the local fog volumes' block (`../../../lighting/atmosphere/layout.ts`), then
 *  the fitted lobe of the rectangles, two `vec4f` per cell. */
export const HEAD_BYTES = SCENE_LIGHT_HEADER_FLOATS * 4
const ATMOSPHERE_BYTES_AT = HEAD_BYTES + SCENE_ENVIRONMENT_FLOATS * 4,
  LTC_BYTES = ATMOSPHERE_BYTES_AT + ATMOSPHERE_REGION_BYTES
const SKIN_AT = LTC_BYTES + LTC_SIZE * LTC_SIZE * 32,
  ENV_BRDF_AT = SKIN_AT + SKIN_TABLE_TEXELS * 4,
  SHEEN_AT = ENV_BRDF_AT + ENV_BRDF_TEXELS * 4,
  PROFILES_AT = SHEEN_AT + SHEEN_LTC_SIZE * SHEEN_LTC_SIZE * 8,
  TRANSMISSIONS_AT = PROFILES_AT + LIT_PROFILE_ROWS * 16
/** Where each region of the buffer starts, in bytes: the atmosphere's regions, the
 *  fog volume's view block, the rectangles' lobe, the skin table, the environment BRDF, the sheen table, the subsurface profiles' rows and their transmission rows, then the light slots. */
export const LIGHT_BUFFER_AT = {
  atmosphere: ATMOSPHERE_BYTES_AT,
  /** The fog volume's view block, which the CPU writes each image its volume is built. */
  fogView: ATMOSPHERE_BYTES_AT + FOG_VIEW_REGION_AT,
  /** The local fog volumes' block, which the CPU writes each image the view draws one (`../../render/localFogView.ts`). */
  localFog: ATMOSPHERE_BYTES_AT + LOCAL_FOG_REGION_AT,
  ltc: LTC_BYTES,
  /** The preintegrated skin table, a word a texel. */
  skin: SKIN_AT,
  /** The preintegrated environment BRDF, a word a texel, written once. */
  envBrdf: ENV_BRDF_AT,
  /** The sheen lobe's table a cloth's fuzz is lit through, two words of four half floats a texel, written once
   *  (`../../../lighting/sheenLtcWgsl.ts`). */
  sheen: SHEEN_AT,
  /** The subsurface profiles' dual specular the lights read, a `vec4f` a profile (`litRows.ts`), written as the profiles change. */
  profiles: PROFILES_AT,
  /** The subsurface profiles' transmission the lights read, `LIT_TRANSMISSION_VEC4S` `vec4f` a profile (`litRows.ts`), written with the rows above. */
  transmissions: TRANSMISSIONS_AT,
  items: TRANSMISSIONS_AT + LIT_PROFILE_ROWS * LIT_TRANSMISSION_VEC4S * 16,
} as const
