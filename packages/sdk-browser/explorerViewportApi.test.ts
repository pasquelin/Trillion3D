import assert from 'node:assert/strict';
import test from 'node:test';
import { createExplorerViewportApi } from './explorerViewportApi.ts';
import { createWebglSurface } from './webglSurface.ts';

test('public resize routes one changed size through the owned surface and skips a no-op', () => {
  const context = {
    isContextLost: () => false,
    getExtension: () => null,
  } as unknown as WebGL2RenderingContext;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  const surface = createWebglSurface(canvas);
  const sizes: number[][] = [];
  const renderer = {
    setDrawingBufferSize(width: number, height: number, ratio: number) {
      sizes.push([width, height, ratio]);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    },
  };
  const viewport: [number, number] = [0, 0];
  const camera = { aspect: 0, updateProjectionMatrix: () => {} };
  const api = createExplorerViewportApi({
    check: () => {},
    active: () => ({}) as never,
    setCapturingSurface: () => {},
    targets: () => ({}),
    camera: camera as never,
    canvas,
    renderer: renderer as never,
    webglSurface: surface,
    viewport,
    directGpu: false,
    options: { manifestUrl: '', pixelRatio: 2 },
  });
  api.resize(40, 30);
  api.resize(40, 30);
  assert.deepEqual(sizes, [[40, 30, 2]]);
  assert.deepEqual(viewport, [80, 60]);
  assert.equal(camera.aspect, 4 / 3);
});

test('public direct-WebGPU resize never touches a supplied WebGL surface', () => {
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  const viewport: [number, number] = [0, 0];
  const api = createExplorerViewportApi({
    check: () => {},
    active: () => ({}) as never,
    setCapturingSurface: () => {},
    targets: () => ({}),
    camera: { aspect: 0, updateProjectionMatrix: () => {} } as never,
    canvas,
    renderer: {} as never,
    webglSurface: { resize: () => assert.fail('WebGL surface used by direct WebGPU') } as never,
    viewport,
    directGpu: true,
    options: { manifestUrl: '', pixelRatio: 1.5 },
  });
  api.resize(20, 10);
  assert.deepEqual(viewport, [30, 15]);
});
