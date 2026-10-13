// A receiver in a wide sun penumbra, generated: a grating of opaque slats 0.1 wide and 0.3 apart,
// 2.8 above a receiver square, under a sun whose disk is 0.1 radian wide: from the receiver a slat's
// penumbra is 0.56 wide, nearly twice the period, so no point of it is lit or shaded whole. The
// receiver is opaque, or a blended surface, or absent; the slats may be taken away (`open`).
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { batisseur, square } from '../kit/sharedSceneProof.ts'

export type Receiver = 'opaque' | 'blend' | 'none'

/** The sun: nearly overhead, a disk of 0.1 radian. */
export const WIDE_SUN: SceneLight = {
  id: 'wide-sun',
  kind: 'directional',
  direction: [0.05, 0.02, -1],
  color: [1, 1, 1],
  intensity: 3,
  angularRadius: 0.1,
  castsShadow: true,
}

/** The receiver's plane, and the camera's height above it, looking straight down. */
const RECEIVER_Z = 0.2
const CAMERA_Z = 1

export function penumbraScene(receiver: Receiver, { open = false, half = 2 } = {}) {
  const builder = batisseur()
  const add = (z: number, x: number, sx: number, sy: number, s: G.GraphSurface, pass: string) => {
    const mesh = G.mesh(square(1), s)
    mesh.position.set(x, 0, z)
    mesh.scale.set(sx, sy, 1)
    builder.source.add(mesh)
    builder.add(mesh, pass, 1)
  }
  const grey = () => G.standardSurface({ color: 0xbbbbbb, roughness: 0.8, side: G.DOUBLE_SIDE })
  add(0, 0, 8, 8, grey(), 'exact-clusters')
  if (!open) for (let x = -4.5; x <= 4.5; x += 0.3) add(3, x, 0.05, 8, grey(), 'exact-clusters')
  if (receiver === 'opaque') add(RECEIVER_Z, 0, half, half, grey(), 'exact-clusters')
  if (receiver === 'blend')
    add(
      RECEIVER_Z,
      0,
      half,
      half,
      G.standardSurface({
        color: 0xbbbbbb,
        roughness: 0.8,
        transparent: true,
        opacity: 1,
        side: G.DOUBLE_SIDE,
      }),
      'clustered-blend',
    )
  return builder.fini()
}

/** The camera looking straight down at the receiver from `CAMERA_Z`. */
export function penumbraCamera(aspect = 1) {
  const camera = G.perspectiveCamera(55, aspect, 0.05, 50)
  camera.position.set(0, 0, CAMERA_Z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}
