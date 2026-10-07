import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts'
import { createFirstPersonCameraControls } from '../../camera/controls/firstPersonControls.ts'
import { createFlyCameraControls } from '../../camera/controls/flyControls.ts'
import {
  createOrbitCameraControls,
  type OrbitCameraControls,
} from '../../camera/controls/orbitControls.ts'
import { createPanZoomCameraControls } from '../../camera/controls/panZoomControls.ts'
import { createTrackballCameraControls } from '../../camera/controls/trackballControls.ts'
import type { PivotCameraControls } from '../../camera/controls/types.ts'
import type { CameraPose } from '../../../../sdk-core/src/index.ts'
import type { MeasuredWorldOptions, PointOfInterest } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'

type Inputs = {
  check: () => void
  options: MeasuredWorldOptions
  camera: HostCamera
  center: HostCamera['position']
  radius: number
  canvas: HTMLCanvasElement
  ownedControls: { dispose(): void }[]
}

/** A point of interest the host declared whole: an id, a label and a pose. */
const declaredPoint = (point: PointOfInterest) =>
  point && typeof point.id === 'string' && typeof point.label === 'string' && !!point.pose

export function createExplorerCameraApi(inputs: Inputs) {
  const { check, options, camera, center, radius, canvas, ownedControls } = inputs
  /** A pivot controller starts on the scene centre, at the distance the camera already has. */
  const pivot = <T extends PivotCameraControls>(controls: T): T => {
    controls.target.copy(center)
    controls.update()
    ownedControls.push(controls)
    return controls
  }
  const homePose = (): CameraPose => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [center.x, center.y, center.z],
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  })
  let orbit: OrbitCameraControls | undefined
  return {
    pointsOfInterest: (): PointOfInterest[] => [
      { id: 'home', label: 'Home', pose: homePose() },
      ...(options.pointsOfInterest ?? []).filter(declaredPoint),
    ],
    homePose,
    /** Six degrees of freedom, keys and drag-to-look; the host integrates it per frame. */
    flyControls() {
      const controls = createFlyCameraControls(camera, canvas)
      controls.movementSpeed = radius / 4
      ownedControls.push(controls)
      return controls
    },
    /** Pointer-locked walk, horizon level; the host integrates it per frame. */
    firstPersonControls() {
      const controls = createFirstPersonCameraControls(camera, canvas)
      controls.movementSpeed = radius / 4
      ownedControls.push(controls)
      return controls
    },
    /** Free spin about the scene centre, roll included, bounded like the orbit. */
    trackballControls: () => pivot(createTrackballCameraControls(camera, canvas)),
    /** Flat view: the camera keeps its direction and only slides and zooms. */
    panZoomControls: () => pivot(createPanZoomCameraControls(camera, canvas)),
    /**
     * The turntable the interactive session drives, made once and reused: a second call on an
     * interactive explorer returns the controller already wired to its frame scheduler. A host
     * that disposes it is handed a NEW one next time, never the dead one, and listens to the
     * `change` of the controller it now holds: the automatic redraw went with the old one.
     */
    controls() {
      check()
      if (explorerSwitch(options, 'interactive') && orbit) return orbit
      const controls = pivot(createOrbitCameraControls(camera, canvas))
      const release = controls.dispose
      controls.dispose = () => {
        if (orbit === controls) orbit = undefined
        release()
      }
      return (orbit = controls)
    },
  }
}
