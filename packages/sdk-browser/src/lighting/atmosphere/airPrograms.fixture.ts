import type { AirProgram } from './programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from './shape.ts'
import { AIR_PROGRAM_MAKERS, type AirProgramName } from './shaders.ts'

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
