import type { BoxTransformLot } from '../../page/decode/batch/batchRuntime.ts'
import { emptyWorldBox, hostWorldBounds } from '../../host/world/bounds.ts'
import { frameBounds } from '../../camera/framing.ts'
import { DEFAULT_FOV } from '../../engine/common.ts'
import type { MeasuredWorldOptions } from '../session/options.ts'
import { hostBox, hostFramingCamera, hostPoint } from '../../host/scene/graphObjects.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

export function createExplorerCamera(
  source: Object3D,
  canvas: HTMLCanvasElement,
  options: MeasuredWorldOptions,
  /** Framing-box buffer, reserved at load; without it, one is made for the framing. */
  lot?: BoxTransformLot | null,
) {
  const flat = emptyWorldBox()
  hostWorldBounds(source, flat, lot)
  // A scene with no node to frame — the page poses the camera itself — frames the unit box.
  const framed = frameBounds(flat, canvas.width / canvas.height)
  // The box and the centre go back to the host — `explorer.bounds` and `explorer.center` are its
  // API, and its controls want a target. The host objects are built at the boundary
  // (`../../host/scene/graphObjects.ts`); no computation is done there, everything comes from the core as numbers.
  const camera = hostFramingCamera(
    options.fov ?? DEFAULT_FOV,
    canvas.width / canvas.height,
    framed.near,
    framed.far,
  )
  const bounds = hostBox(flat)
  const center = hostPoint(...framed.centre)
  camera.position.set(...framed.position)
  camera.lookAt(center)
  camera.updateMatrixWorld()
  return { bounds, center, radius: framed.radius, camera }
}
