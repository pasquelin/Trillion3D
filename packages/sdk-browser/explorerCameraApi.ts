import { createFirstPersonCameraControls } from './cameraFirstPersonControls.ts';
import { createFlyCameraControls } from './cameraFlyControls.ts';
import { createOrbitCameraControls } from './cameraOrbitControls.ts';
import { createPanZoomCameraControls } from './cameraPanZoomControls.ts';
import { createTrackballCameraControls } from './cameraTrackballControls.ts';
import type { PivotCameraControls } from './cameraControlTypes.ts';
import { copyElements } from './matrixElements.ts';
import type { CameraPose } from '../sdk-core/src/index.ts';
import type { MeasuredWorldOptions, PointOfInterest, RenderBackend } from './backendTypes.ts';
import { resolveCameraWorld, type HostCamera } from './cameraWorld.ts';

type Inputs = {
  check: () => void;
  options: MeasuredWorldOptions;
  camera: HostCamera;
  center: HostCamera['position'];
  homeOffset: HostCamera['position'];
  lookAtTarget: HostCamera['position'];
  radius: number;
  canvas: HTMLCanvasElement;
  backends: RenderBackend[];
  disposed: () => boolean;
  setMeasuring: (value: boolean) => void;
  setActive: (backend: RenderBackend) => void;
  hostedControls: { dispose(): void }[];
};

export function createExplorerCameraApi(inputs: Inputs) {
  const {
    check,
    options,
    camera,
    center,
    homeOffset,
    lookAtTarget,
    radius,
    canvas,
    backends,
    disposed,
    setMeasuring,
    setActive,
    hostedControls,
  } = inputs;
  /** A pivot controller starts on the scene centre, at the distance the camera already has. */
  const pivot = <T extends PivotCameraControls>(controls: T): T => {
    controls.target.copy(center);
    controls.update();
    hostedControls.push(controls);
    return controls;
  };
  const homePose = (): CameraPose => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [center.x, center.y, center.z],
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  });
  let orbit: PivotCameraControls | undefined;
  return {
    pointsOfInterest(): Array<PointOfInterest> {
      const extras = (options.pointsOfInterest ?? []).filter(
        (point) =>
          point && typeof point.id === 'string' && typeof point.label === 'string' && point.pose,
      );
      return [{ id: 'home', label: 'Home', pose: homePose() }, ...extras];
    },
    resetHome() {
      check();
      camera.position.set(
        center.x + homeOffset.x,
        center.y + homeOffset.y,
        center.z + homeOffset.z,
      );
      lookAtTarget.copy(center);
      camera.lookAt(center);
      camera.updateMatrixWorld();
    },
    // Every frame binds its own destination: leaving the measurement surface is the flag alone.
    restoreAfterCampaign(id: string, saved: HostCamera) {
      if (disposed()) return;
      setMeasuring(false);
      setActive(backends.find((backend) => backend.id === id)!);
      // The saved view goes back on the live camera number by number — local pose and declared
      // optics — then its matrices are recomposed from them: what a host camera holds besides
      // these is derived from them. The LOCAL MATRIX comes back beside the three fields, with the
      // flag that says which of the two is the pose: a host that poses its camera by matrix keeps
      // `matrixAutoUpdate` false, and `updateMatrixWorld` then recomposes nothing — restoring the
      // fields alone would leave that camera on the pose the campaign left it at.
      const { x, y, z, w } = saved.quaternion;
      camera.position.copy(saved.position);
      camera.quaternion.set(x, y, z, w);
      camera.fov = saved.fov;
      camera.aspect = saved.aspect;
      camera.near = saved.near;
      camera.far = saved.far;
      camera.zoom = saved.zoom;
      copyElements(camera.matrix.elements, saved.matrix.elements);
      camera.matrixAutoUpdate = saved.matrixAutoUpdate;
      camera.updateProjectionMatrix();
      // `updateMatrixWorld` recomposes nothing when the host poses by matrix: writing
      // `matrix` raises no update flag. The contract's resolve composes it unconditionally.
      resolveCameraWorld(camera);
      lookAtTarget.copy(center);
    },
    setMeasurementSurface(enabled: boolean) {
      check();
      setMeasuring(enabled);
    },
    homePose,
    /** Six degrees of freedom, keys and drag-to-look; the host integrates it per frame. */
    flyControls() {
      const controls = createFlyCameraControls(camera, canvas);
      controls.movementSpeed = radius / 4;
      hostedControls.push(controls);
      return controls;
    },
    /** Pointer-locked walk, horizon level; the host integrates it per frame. */
    firstPersonControls() {
      const controls = createFirstPersonCameraControls(camera, canvas);
      controls.movementSpeed = radius / 4;
      hostedControls.push(controls);
      return controls;
    },
    /** Free spin about the scene centre, roll included, bounded like the orbit. */
    trackballControls() {
      const controls = createTrackballCameraControls(camera, canvas);
      return pivot(controls);
    },
    /** Flat view: the camera keeps its direction and only slides and zooms. */
    panZoomControls() {
      const controls = createPanZoomCameraControls(camera, canvas);
      return pivot(controls);
    },
    /**
     * The turntable the interactive session drives, made once and reused: a second call on an
     * interactive explorer returns the controller already wired to its frame scheduler.
     *
     * A host that disposes it is handed a NEW one next time, never the dead one: swapping
     * controller means releasing the surface, and a page that offers several has to be able
     * to come back to this one. The automatic redraw went with the controller it was bound
     * to, so that host listens to the `change` of the controller it now holds.
     */
    controls() {
      check();
      if (options.interactive && orbit) return orbit;
      const controls = pivot(createOrbitCameraControls(camera, canvas));
      const release = controls.dispose;
      controls.dispose = () => {
        if (orbit === controls) orbit = undefined;
        release();
      };
      return (orbit = controls);
    },
  };
}
