// What the reflection's tests read of its shaders: a constant's value, and a fragment a program
// holds, both taken from the program that ships them.
import type { WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'
import { reflectionFieldWgsl } from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'

/** The value of the shaders' constant `name`, as the shader writes it. */
export function reflectionConstant(name: string) {
  const match = new RegExp(`const ${name}:\\w+=([\\d.e+-]+)`).exec(REFLECTION_CONSTANTS_WGSL.text)
  if (!match) throw new Error(`no reflection constant ${name}`)
  return Number(match[1])
}

const dependency = (program: WgslDecl, name: string) => {
  const found = program.deps.find((dep) => dep.name === name)
  if (!found) throw new Error(`${program.name} holds no ${name}`)
  return found
}

/** The environment's fragment, as the reflection field holds it. */
export const environmentWgsl = () =>
  dependency(reflectionFieldWgsl(false), 'REFLECTION_ENVIRONMENT_WGSL')

/** The cone's fragment, as the footprint holds it. */
export const coneWgsl = () => dependency(reflectionFootprintWgsl(0), 'REFLECTION_CONE_WGSL')
