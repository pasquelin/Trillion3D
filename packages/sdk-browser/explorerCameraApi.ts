import * as THREE from 'three';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraPose } from '../sdk-core/index.ts';
import type { ExplorerOptions, PointOfInterest, RenderBackend } from './backendTypes.ts';

type Inputs = {
  check: () => void;
  options: ExplorerOptions;
  camera: THREE.PerspectiveCamera;
  center: THREE.Vector3;
  homeOffset: THREE.Vector3;
  lookAtTarget: THREE.Vector3;
  radius: number;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
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
    renderer,
    backends,
    disposed,
    setMeasuring,
    setActive,
    hostedControls,
  } = inputs;
  const homePose = (): CameraPose => ({
    position: camera.position.toArray() as CameraPose['position'],
    target: center.toArray() as CameraPose['target'],
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  });
  let orbit: OrbitControls | undefined;
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
    restoreAfterCampaign(id: string, saved: THREE.PerspectiveCamera) {
      if (disposed()) return;
      setMeasuring(false);
      renderer.setRenderTarget(null);
      setActive(backends.find((backend) => backend.id === id)!);
      camera.copy(saved);
      lookAtTarget.copy(center);
    },
    setMeasurementSurface(enabled: boolean) {
      check();
      setMeasuring(enabled);
      if (!enabled) renderer.setRenderTarget(null);
    },
    homePose,
    flyControls() {
      const controls = new FlyControls(camera, canvas);
      controls.movementSpeed = radius / 4;
      controls.rollSpeed = 0.4;
      controls.dragToLook = true;
      hostedControls.push(controls);
      return controls;
    },
    controls() {
      check();
      if (options.interactive && orbit) return orbit;
      const controls = new OrbitControls(camera, canvas);
      controls.target.copy(center);
      orbit = controls;
      controls.enableDamping = false;
      controls.update();
      hostedControls.push(controls);
      return controls;
    },
  };
}
