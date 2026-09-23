import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createExplorerViewportApi } from './viewportApi.ts';
import { createWebglSurface } from '../../webgl/core/surface.ts';
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts';
import type { HostCamera } from '../../camera/world.ts';

test('public resize sizes the owned surface once, and the composition targets in its pixels', () => {
  const context = {
    isContextLost: () => false,
    getExtension: () => null,
  } as unknown as WebGL2RenderingContext;
  const sizes: number[][] = [];
  const canvas = {
    get width() {
      return sizes.at(-1)?.[0] ?? 0;
    },
    set width(value: number) {
      sizes.push([value, sizes.at(-1)?.[1] ?? 0]);
    },
    get height() {
      return sizes.at(-1)?.[1] ?? 0;
    },
    set height(value: number) {
      sizes.push([sizes.at(-1)?.[0] ?? 0, value]);
    },
    getContext: () => context,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  const surface = createWebglSurface(canvas);
  const resized: number[][] = [];
  const target = { resize: (width: number, height: number) => resized.push([width, height]) };
  const viewport: [number, number] = [0, 0];
  const camera = { aspect: 0, updateProjectionMatrix: () => {} };
  const api = createExplorerViewportApi({
    check: () => {},
    active: () => ({}) as never,
    setCapturingSurface: () => {},
    targets: () => [{ current: () => target } as never, undefined],
    camera: camera as never,
    canvas,
    webglSurface: surface,
    viewport,
    options: { manifestUrl: '', pixelRatio: 2 },
  });
  api.resize(40, 30);
  api.resize(40, 30);
  assert.deepEqual(
    sizes,
    [
      [80, 0],
      [80, 60],
    ],
    'the drawing buffer is written once per axis',
  );
  assert.deepEqual(
    resized,
    [
      [80, 60],
      [80, 60],
    ],
    'targets follow the drawing buffer',
  );
  assert.deepEqual(viewport, [80, 60]);
  assert.equal(camera.aspect, 4 / 3);
});

test('public direct-WebGPU resize sizes the page canvas, having no WebGL surface', () => {
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  const viewport: [number, number] = [0, 0];
  const api = createExplorerViewportApi({
    check: () => {},
    active: () => ({}) as never,
    setCapturingSurface: () => {},
    targets: () => [],
    camera: { aspect: 0, updateProjectionMatrix: () => {} } as never,
    canvas,
    webglSurface: undefined,
    viewport,
    options: { manifestUrl: '', pixelRatio: 1.5 },
  });
  api.resize(20, 10);
  assert.deepEqual(viewport, [30, 15]);
});

// THE CAPTURE VIEW IS AIMED AT A REAL HOST POINT.
//
// `captureSurfaceView` clones the live camera and aims it at the pose's target. A host library
// tells its own vector from a triple of numbers by a flag of its own: handed a plain
// `{ x, y, z }` literal it reads the object as the first number and the other two as
// `undefined`, and the world matrix comes out `[NaN, NaN, NaN, 0]`. The existing capture tests
// call the backend directly and never go through this boundary, so the view is checked here,
// where it is built: its sixteen floats are finite and it looks at the target it was given.
test('captureSurfaceView hands the backend a finite view aimed at the pose target', async () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
  camera.position.set(1, 2, 3);
  camera.updateMatrixWorld();
  let view: HostCamera | undefined;
  const backend = { id: 'webgpu-page-raster' } as RenderBackend;
  // What a real backend gives back needs a device; the view it was handed does not, so the
  // capture records it and stops there, and the boundary lowers its flag in its `finally`.
  backend.captureSurfaceView = async (given) => {
    view = given;
    throw new Error('CAPTURE_STOPPED');
  };
  const api = createExplorerViewportApi({
    check: () => {},
    active: () => backend,
    setCapturingSurface: () => {},
    targets: () => [],
    camera,
    canvas: { width: 8, height: 8 } as HTMLCanvasElement,
    viewport: [8, 8],
    options: {} as MeasuredWorldOptions,
  });
  await assert.rejects(
    api.captureSurfaceView(
      { position: [4, 0, 0], target: [0, 0, 0], fov: 60, near: 0.5, far: 200 },
      { width: 4, height: 2 },
    ),
    /CAPTURE_STOPPED/,
  );
  assert.ok(view, 'the backend must have received a view');
  const elements = Array.from(view.matrixWorld.elements);
  assert.equal(elements.length, 16);
  assert.ok(
    elements.every((value) => Number.isFinite(value)),
    `the capture view must have a finite world matrix, got ${elements.join(', ')}`,
  );
  // Aimed at the origin from `+x`: a camera looks down its own `-z`, so the third column — the
  // axis pointing BACK from the target — is `+x`, and the fourth column is the eye.
  assert.ok(Math.abs(elements[8] - 1) < 1e-12, `looks at the target, got ${elements[8]}`);
  assert.deepEqual([elements[12], elements[13], elements[14]], [4, 0, 0]);
});
