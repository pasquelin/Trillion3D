import { publishProgram } from './airTintWgsl.ts'
import { capture360Program } from './capture360Wgsl.ts'
import { captureProgramsOf } from './captureWgsl.ts'
import { hazeProgram } from './hazeWgsl.ts'
import type { AirProgram } from './programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'
import { skyRaysProgram } from './skyRaysWgsl.ts'
import { multiScatterProgram, skyViewProgram, transmittanceProgram } from './tablesWgsl.ts'

/** The atmosphere's programs by what they do, each made for a shape: its three tables, the copy of
 *  the transmittance table the surfaces read, the haze
 *  volume (and the one that keeps the haze's light and the air's apart too), the volume around a
 *  capture, the sum of the sky, the sky by direction, and the sky's draw. */
export const AIR_PROGRAM_MAKERS = {
  transmittance: transmittanceProgram,
  multiScatter: multiScatterProgram,
  publish: publishProgram,
  skyView: skyViewProgram,
  haze: (shape: AirShape) => hazeProgram(shape, false),
  hazeSeparate: (shape: AirShape) => hazeProgram(shape, true),
  capture360: capture360Program,
  distantSky: (shape: AirShape) => captureProgramsOf(shape).distantSky,
  skyRays: skyRaysProgram,
  sky: skyProgram,
} satisfies Record<string, (shape: AirShape) => AirProgram>

/** The name of one of the atmosphere's programs. */
export type AirProgramName = keyof typeof AIR_PROGRAM_MAKERS

/** Every program, made for `shape`. */
export const airProgramsOf = (shape: AirShape) =>
  Object.fromEntries(
    Object.entries(AIR_PROGRAM_MAKERS).map(([name, make]) => [name, make(shape)]),
  ) as Record<AirProgramName, AirProgram>

/** The programs of the defaults' shape: what the checks read, and what another module builds on. */
export const AIR_PROGRAMS = /* @__PURE__ */ airProgramsOf(DEFAULT_AIR_SHAPE)

/** Each program's text for the defaults' shape, by name. */
export const AIR_SHADERS = Object.fromEntries(
  Object.entries(AIR_PROGRAMS).map(([name, program]) => [name, program.code]),
) as Record<AirProgramName, string>
