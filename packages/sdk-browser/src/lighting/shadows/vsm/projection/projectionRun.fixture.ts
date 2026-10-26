// The projection's kernel pieces under test (`lightReach.test.ts`, `subsurfaceShadow.test.ts`): the local lights'
// shipped module and what `shaderRun` needs to run its pieces.
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { builtins } from '../../../../materials/texture/shaderRunBuiltins.fixture.ts'
import { vsmLocalsProjectionWgsl } from './projectionWgsl.ts'
import { vsmLayout } from '../layout.ts'

export const PROJECTION_CODE = vsmLocalsProjectionWgsl(
  vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }),
  'rg32uint',
)

/** What a run of the kernel's pieces reads beside them: the module's constants, an inverse square
 *  root, and a vector's bits as floats. Its integer words stay exact: no binary32 rounding of
 *  their arithmetic (`F32_SCOPE` rounds every sum). */
export const PROJECTION_SCOPE = {
  ...wgslConstants(PROJECTION_CODE),
  inverseSqrt: (x: number) => 1 / Math.sqrt(x),
  bitcast_vec3f: builtins.bitcast_f32,
}
