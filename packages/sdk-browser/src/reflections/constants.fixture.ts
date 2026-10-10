// The reflection's tuned constants as the shaders read them, for the tests that state a rule in
// terms of them: read from the shipped constants block (`REFLECTION_CONSTANTS_WGSL`), never a copy.
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'

/** The `f32` value the shaders read for the constant `name` of the reflection's constants block. */
export function reflectionConstant(name: string) {
  const declared = new RegExp(`const ${name}:f32=([^;]+);`).exec(REFLECTION_CONSTANTS_WGSL.text)
  if (!declared) throw new Error(`no reflection constant ${name}`)
  return Number(declared[1])
}
