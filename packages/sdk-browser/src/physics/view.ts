import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import { normalizeVector3 } from '../../../math/src/vector/vector.ts'
import { perspectiveDiagonalSlope } from '../../../math/src/projection/camera.ts'

/**
 * The page's view as the simulation needs it (`VIEW`, `layout.ts`): distance decides what is
 * simulated — the range is `world.physics.simulationRange`, else the camera's draw distance
 * (`camera.far`), the scene's own, never a constant —, the view cone decides what is sent back.
 * The pose is read through the camera contract (`camera/world.ts`), and written only when it
 * changed; the range in force is returned.
 */
export function createPhysicsView() {
  /** Eye (3), facing (3), half cone, range: as last sent. */
  const last = new Float64Array(8).fill(NaN),
    now = new Float64Array(8)
  return (camera: Camera, writer: CommandWriter, range: number | null) => {
    const w = resolveCameraWorld(camera).matrixWorld.elements
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
    now[7] = range ?? camera.far
    let same = true
    for (let k = 0; k < 8; k++) same &&= now[k] === last[k]
    if (same) return now[7]
    last.set(now)
    writer.view(now.subarray(0, 3), now.subarray(3, 6), now[6], now[7])
    return now[7]
  }
}
