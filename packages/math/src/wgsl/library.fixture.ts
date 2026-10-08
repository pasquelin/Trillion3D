import { readdirSync } from 'node:fs'
import type { WgslDecl } from './decl.ts'
import * as barycentric from './barycentric.ts'
import * as basis from './basis.ts'
import * as color from './color.ts'
import * as constants from './constants.ts'
import * as double from './double.ts'
import * as doubleWords from './doubleWords.ts'
import * as f32 from './f32.ts'
import * as geometry from './geometry.ts'
import * as integer from './integer.ts'
import * as inverseTranspose from './inverseTranspose.ts'
import * as lighting from './lighting.ts'
import * as matrix from './matrix.ts'
import * as octahedral from './octahedral.ts'
import * as projection from './projection.ts'
import * as reals from './reals.ts'
import * as sampling from './sampling.ts'

/** The library's declaration files, by name: a file left out of this list would escape the tests
 *  that sweep the engine's shaders, so one is refused below. */
const MODULES = {
  barycentric,
  basis,
  color,
  constants,
  double,
  doubleWords,
  f32,
  geometry,
  integer,
  inverseTranspose,
  lighting,
  matrix,
  octahedral,
  projection,
  reals,
  sampling,
}
/** The files that declare nothing: the declaration type, the assembler, its comment reader, the
 *  number writer. */
const TOOLS = new Set(['decl', 'assemble', 'comments', 'number'])

const files = readdirSync(new URL('.', import.meta.url))
  .filter((file) => file.endsWith('.ts') && !/\.(test|fixture)\.ts$/.test(file))
  .map((file) => file.slice(0, -3))
  .filter((file) => !TOOLS.has(file))
const unregistered = files.filter((file) => !(file in MODULES))
if (unregistered.length) throw new Error(`WGSL library files not registered: ${unregistered}`)

/** Every declaration of the WGSL library, for the tests that sweep the engine's shaders: those a
 *  shader imports from their own module, and those only another declaration calls. */
const library = new Set<WgslDecl>()
const hold = (decl: WgslDecl) => {
  if (library.has(decl)) return
  library.add(decl)
  decl.deps.forEach(hold)
}
Object.values(MODULES)
  .flatMap((module) => Object.values(module))
  .forEach(hold)

export const WGSL_LIBRARY: readonly WgslDecl[] = [...library]
