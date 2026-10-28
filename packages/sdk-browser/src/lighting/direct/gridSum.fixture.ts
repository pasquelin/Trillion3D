// What the grid-sum proofs share: the four programs the resolve compiles (with and without shadow code, with and without rectangle code),
// and the scope their light term runs in as JavaScript.
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from './lightLoop.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

export const PROGRAMS = [false, true].flatMap((shadowed) =>
  [false, true].map((rects) =>
    wgslModule(
      directLightingWgsl({ unshadowed: !shadowed, rectless: !rects, lobeless: true }),
      STANDARD_LIGHTING_WGSL,
    ),
  ),
)
export const NAMES = ['sliceLighting']
export const K = wgslConstants(PROGRAMS[0])

export /** What a program's light term reads besides the lights: no thin transmission, a lamp with no shadow
 *  slot (the shipped read answers one), the air's transmittance toward a light read per point: none. */
const scopeOf = (program: string, directLights: object, tileLights: number[]) => ({
  ...wgslConstants(program),
  directLights,
  tileLights,
  pixelModel: 0,
  sphereNoNewton: false,
  clearCoatBottom: false,
  mat2x3f: (a = [0, 0, 0], b = [0, 0, 0]) => [a, b],
  thinSubsurface: [0, 0, 0],
  surfaceModel: 2,
  shadowFactor: () => 1,
  airTintOf: () => [1, 1, 1],
  cloudShadowOnSurface: () => 1,
})
