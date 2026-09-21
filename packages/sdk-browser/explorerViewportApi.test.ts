import assert from 'node:assert/strict';
import test from 'node:test';
import { createExplorerViewportApi } from './explorerViewportApi.ts';
import { createWebglSurface } from './webglSurface.ts';

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
    targets: () => [target as never, undefined],
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
