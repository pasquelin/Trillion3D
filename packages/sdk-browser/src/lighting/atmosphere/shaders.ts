import { publishProgram } from './airTintWgsl.ts'
import { capture360Program } from './capture360Wgsl.ts'
import { captureProgramsOf } from './captureWgsl.ts'
import { hazeProgram } from './hazeWgsl.ts'
import type { AirProgram } from './programs.ts'
import type { AirShape } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'
import { multiScatterProgram, skyViewProgram, transmittanceProgram } from './tablesWgsl.ts'

/** The atmosphere's programs by what they do, each made for a shape: its three tables, the copy of
 *  the transmittance table the surfaces read, the haze
 *  volume (and the one that keeps the haze's light and the air's apart too), the volume around a
 *  capture, the sum of the sky, and the sky's draw. */
export const AIR_PROGRAM_MAKERS = {
  transmittance: transmittanceProgram,
  multiScatter: multiScatterProgram,
  publish: publishProgram,
  skyView: skyViewProgram,
  haze: (shape: AirShape) => hazeProgram(shape, false),
  hazeSeparate: (shape: AirShape) => hazeProgram(shape, true),
  capture360: capture360Program,
  distantSky: (shape: AirShape) => captureProgramsOf(shape).distantSky,
  sky: skyProgram,
} satisfies Record<string, (shape: AirShape) => AirProgram>

/** The name of one of the atmosphere's programs. */
export type AirProgramName = keyof typeof AIR_PROGRAM_MAKERS
