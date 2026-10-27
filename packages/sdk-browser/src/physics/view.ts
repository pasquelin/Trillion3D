import type { CommandWriter } from '../../../sdk-core/src/physics/commands.ts'
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { normalizeVector3 } from '../../../math/src/vector/vector.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { perspectiveDiagonalSlope } from '../../../math/src/projection/camera.ts'

/** The engine camera an orthographic `camera` is drawn from, `drawn`, where an image has been drawn:
 *  its planes moved the origin and the far plane (`camera/world.ts`), which the simulation's view
 *  follows. `null` for a perspective camera, which is never moved, and before the first image. */
const movedView = (camera: Camera, drawn?: EngineCamera | null) =>
  drawn && camera.projection === 'orthographic' ? drawn : null

/** The world matrix the simulation's view stands at: the moved view's (`movedView`), else the
 *  camera's, resolved through the camera contract. */
export function viewWorld(camera: Camera, drawn?: EngineCamera | null) {
  return movedView(camera, drawn)?.world ?? resolveCameraWorld(camera).matrixWorld.elements
}

/**
 * The page's view as the simulation needs it (`VIEW`, `layout.ts`): distance decides what is
 * simulated — the range is `world.physics.simulationRange`, else the camera's draw distance
 * (`camera.far`), the scene's own, never a constant —, the view cone decides what is sent back.
 * The pose is read through the camera contract (`camera/world.ts`), and written only when it
 * changed; the range in force is returned. An orthographic camera's view is the drawn one's, its origin
 * and far plane as its planes put them (`movedView`).
 */
export function createPhysicsView() {
  /** Eye (3), facing (3), half cone, range: as last sent. */
  const last = new Float64Array(8).fill(NaN),
    now = new Float64Array(8)
  return (
    camera: Camera,
    writer: CommandWriter,
    range: number | null,
    drawn?: EngineCamera | null,
  ) => {
    const w = viewWorld(camera, drawn)
    // The eye is the world matrix's translation; the camera looks down its own −z, made unit.
    now[0] = w[12]
    now[1] = w[13]
    now[2] = w[14]
    for (let k = 0; k < 3; k++) now[3 + k] = -w[8 + k]
    normalizeVector3(now, 3)
    // The half cone reaches the picture's corners: the angle of the diagonal slope.
    now[6] =
      camera.projection === 'perspective'
        ? Math.atan(perspectiveDiagonalSlope(camera.fov, camera.aspect))
        : 0
    now[7] = range ?? movedView(camera, drawn)?.far ?? camera.far
    if (sameValues(now, last)) return now[7]
    last.set(now)
    writer.view(now.subarray(0, 3), now.subarray(3, 6), now[6], now[7])
    return now[7]
  }
}
