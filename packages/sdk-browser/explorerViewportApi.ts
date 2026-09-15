import * as THREE from 'three';
import type { CameraPose } from '../sdk-core/index.ts';
import { devicePixels } from './backendCommon.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  setCapturingSurface: (value: boolean) => void;
  targets: () => {
    measurement?: THREE.WebGLRenderTarget;
    left?: THREE.WebGLRenderTarget;
    right?: THREE.WebGLRenderTarget;
  };
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  viewport: [number, number];
  directGpu: boolean;
  options: ExplorerOptions;
};

export function createExplorerViewportApi(inputs: Inputs) {
  const {
    check,
    active: getActive,
    setCapturingSurface,
    targets,
    camera,
    canvas,
    renderer,
    viewport,
    directGpu,
    options,
  } = inputs;
  return {
    async captureSurfaceView(
      pose: CameraPose,
      size: { width: number; height: number; signal?: AbortSignal },
    ) {
      check();
      const active = getActive();
      if (!active.captureSurfaceView) throw new Error('SURFACE_CAPTURE_UNSUPPORTED');
      const view = camera.clone();
      view.position.fromArray(pose.position);
      view.fov = pose.fov;
      view.near = pose.near;
      view.far = pose.far;
      view.aspect = size.width / size.height;
      view.lookAt(new THREE.Vector3().fromArray(pose.target));
      view.updateProjectionMatrix();
      view.updateMatrixWorld();
      setCapturingSurface(true);
      try {
        return await active.captureSurfaceView(view, size);
      } finally {
        setCapturingSurface(false);
      }
    },
    resize(width: number, height: number) {
      check();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
        throw new Error('Invalid viewport size');
      if (directGpu) {
        canvas.width = devicePixels(width, options.pixelRatio);
        canvas.height = devicePixels(height, options.pixelRatio);
      } else renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      viewport[0] = canvas.width;
      viewport[1] = canvas.height;
      const current = targets();
      current.measurement?.setSize(width, height);
      current.left?.setSize(width, height);
      current.right?.setSize(width, height);
    },
  };
}
