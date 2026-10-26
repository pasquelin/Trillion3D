import { DEG2RAD, RAD2DEG } from '../../../../math/src/constants.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import {
  primitiveDistanceFactor,
  viewDistanceFactor,
} from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The horizontal field of view of `cam` in degrees, from the optics it declares; 0 for an
 *  orthographic view. */
function horizontalFieldOfView(cam: Pick<EngineCamera, 'fov' | 'aspect' | 'perspective'>) {
  if (cam.perspective === 0) return 0
  return 2 * RAD2DEG * Math.atan(Math.tan(0.5 * cam.fov * DEG2RAD) * cam.aspect)
}

/**
 * The scales the draw distances of the view drawn under `cam` are multiplied by, written into its
 * cut's `uniforms` (`viewDistanceScale` for the instances of an instanced mesh, `primitiveDistanceScale`
 * for an object of its own, the field of view's scale included).
 */
export function writeDrawDistanceScales(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  uniforms: SelectionUniforms,
) {
  uniforms.viewDistanceScale = viewDistanceFactor(rt)
  uniforms.primitiveDistanceScale = primitiveDistanceFactor(rt, horizontalFieldOfView(cam))
}
