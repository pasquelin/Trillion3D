import type { CameraPose } from '../../../../sdk-core/src/index.ts';
import { devicePixels } from '../../backend/common.ts';
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { BoundTarget } from '../render/hostState.ts';
import { hostPoint } from '../../host/scene/graphObjects.ts';
import type { WebglSurface } from '../../webgl/core/surface.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  setCapturingSurface: (value: boolean) => void;
  targets: () => (BoundTarget | undefined)[];
  camera: HostCamera;
  canvas: HTMLCanvasElement;
  /** The engine's surface, which owns the drawing buffer; absent on the direct WebGPU path only,
   *  where the page canvas is sized directly. */
  webglSurface?: WebglSurface;
  viewport: [number, number];
  options: MeasuredWorldOptions;
};

export function createExplorerViewportApi(inputs: Inputs) {
  const {
    check,
    active: getActive,
    setCapturingSurface,
    targets,
    camera,
    canvas,
    webglSurface,
    viewport,
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
      view.lookAt(hostPoint(pose.target[0], pose.target[1], pose.target[2]));
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
      if (webglSurface) webglSurface.resize(width, height, options.pixelRatio ?? 1);
      else {
        canvas.width = devicePixels(width, options.pixelRatio);
        canvas.height = devicePixels(height, options.pixelRatio);
      }
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      viewport[0] = canvas.width;
      viewport[1] = canvas.height;
      // The composition targets follow the drawing buffer, in its pixels.
      for (const target of targets()) target?.current()?.resize(canvas.width, canvas.height);
    },
  };
}
