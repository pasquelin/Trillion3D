import { CAPTURE_PROGRAMS } from './captureWgsl.ts'
import { HAZE_PROGRAM } from './hazeWgsl.ts'
import type { AirProgram } from './programs.ts'
import { SKY_PROGRAM } from './skyWgsl.ts'
import { SKY_RAYS_PROGRAM } from './skyRaysWgsl.ts'
import { MULTISCATTER_PROGRAM, SKY_VIEW_PROGRAM, TRANSMITTANCE_PROGRAM } from './tablesWgsl.ts'

/** The atmosphere's programs by what they do: its three tables, the haze volume, the sums of the
 *  sky, the sky by direction, and the sky's draw. */
export const AIR_PROGRAMS = {
  transmittance: TRANSMITTANCE_PROGRAM,
  multiScatter: MULTISCATTER_PROGRAM,
  skyView: SKY_VIEW_PROGRAM,
  haze: HAZE_PROGRAM,
  distantSky: CAPTURE_PROGRAMS.distantSky,
  skyCapture: CAPTURE_PROGRAMS.skyCapture,
  skyRays: SKY_RAYS_PROGRAM,
  sky: SKY_PROGRAM,
} satisfies Record<string, AirProgram>

/** The name of one of the atmosphere's programs. */
export type AirProgramName = keyof typeof AIR_PROGRAMS

/** Each program's text, by name: what is handed to a shader module. */
export const AIR_SHADERS = Object.fromEntries(
  Object.entries(AIR_PROGRAMS).map(([name, program]) => [name, program.code]),
) as Record<AirProgramName, string>
