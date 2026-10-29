import { GLASS_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/glassEnergy.ts'
import { SHADING_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { SHEEN_LTC_SIZE } from '../../../../sdk-core/src/lighting/sheenLtc.ts'

/** The words of the GGX energy table that heads the lights' buffer, then the sheen table's (two words a texel), then the glass energy table's (one word a texel), then the records. */
export const PT_ENERGY_WORDS = SHADING_ENERGY_SIZE * SHADING_ENERGY_SIZE
export const PT_SHEEN_WORDS = SHEEN_LTC_SIZE * SHEEN_LTC_SIZE * 2
export const PT_GLASS_WORDS = GLASS_ENERGY_SIZE ** 3

/** Where the tables begin in the lights' buffer, in words, and the words they take together. */
export const PT_SHEEN_AT = PT_ENERGY_WORDS
export const PT_GLASS_AT = PT_SHEEN_AT + PT_SHEEN_WORDS
export const PT_LIGHT_TABLE_WORDS = PT_GLASS_AT + PT_GLASS_WORDS

/** The structure the lights' buffer is read as in the path tracer's programs (`directLights`): the tables the materials read, then the lights. The sheen table is read by the lights' library (`sheenLtcCoefficients`) as it reads its own. */
export const PT_LIGHT_TABLE_STRUCT = `struct PtLightTable{energy:array<u32,${PT_ENERGY_WORDS}>,sheen:array<vec2u,${SHEEN_LTC_SIZE * SHEEN_LTC_SIZE}>,glass:array<u32,${PT_GLASS_WORDS}>,lights:array<PtLight>}`
