import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawFrameAt,
  frameSizeOf,
  imageScale,
  renderExtent,
  renderMipBias,
  renderPixelRatio,
  type FrameSize,
} from './renderScale.ts';
import { createScaleControl } from '../../../frame/scaleControl.ts';
import type { RenderScale } from '../../../frame/renderScaleOption.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const DISPLAY = [3456, 2234];

/** A view that accumulates in the beauty view, the page asking `scale`, its targets made at
 *  `allocated` for the boss's display; `extents` hears what the Hi-Z pyramid is built over. */
function runtime(scale: RenderScale | undefined, allocated = DISPLAY, apart = true) {
  const extents: number[][] = [],
    colorTexture = {};
  const rt = {
    setup: { viewport: DISPLAY, pixelRatio: () => 2 },
    context: {},
    scale: createScaleControl(scale),
    gpu: {
      temporal: { upscales: () => true },
      temporalWanted: true,
      targetSize: [...allocated],
      allocatedSize: [...allocated],
      displaySize: DISPLAY,
      colorTexture,
      displayTexture: apart ? {} : colorTexture,
    },
    run: { diagnostic: 'beauty' },
    vis: { visEnabled: true, gpuHiz: { extent: (w: number, h: number) => extents.push([w, h]) } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, extents };
}

const sizeOf = (rt: WebgpuPagesRuntime) => ({ ...frameSizeOf(rt, {} as FrameSize) });

test('a render axis is the display at native size, else a multiple of eight', () => {
  assert.equal(renderExtent(1117, 1), 1117, 'native size keeps an odd axis as it is');
  assert.equal(renderExtent(3456, 0.5), 1728);
  assert.equal(renderExtent(2234, 0.5), 1120);
  assert.equal(renderExtent(3456, 0.67), 2312);
  assert.equal(renderExtent(12, 0.5), 8, 'never below eight');
});

// #832: the targets are made once at the bounds' maximum, the display colour apart.
test('the targets are made at the maximum, apart from the display wherever a scale may drop', () => {
  const native = { width: 3456, height: 2234, renderWidth: 3456, renderHeight: 2234 };
  assert.deepEqual(sizeOf(runtime('auto').rt), { ...native, apart: true });
  assert.deepEqual(sizeOf(runtime({ min: 0.6, max: 0.8 }).rt), {
    ...native,
    renderWidth: 2768,
    renderHeight: 1784,
    apart: true,
  });
  assert.deepEqual(sizeOf(runtime(0.5).rt), {
    ...native,
    renderWidth: 1728,
    renderHeight: 1120,
    apart: true,
  });
  assert.deepEqual(sizeOf(runtime(1).rt), { ...native, apart: false }, 'fixed at 1: as before');
  assert.deepEqual(sizeOf(runtime(undefined).rt), { ...native, apart: false });
});

// #816: only where the temporal resolve reconstructs the display is the frame drawn below it.
test('the frame is drawn below the display only when the temporal resolve reconstructs it', () => {
  const changes: [string, (view: WebgpuPagesRuntime) => void][] = [
    ['a diagnostic view', (view) => (view.run.diagnostic = 'normals' as never)],
    ['the pass switched off', (view) => (view.gpu.temporalWanted = false)],
    ['no pass: a capture view', (view) => (view.gpu.temporal = undefined)],
    ['the fallback draw', (view) => (view.vis.visEnabled = false)],
    ['a GPU variant', (view) => (view.context.diagnosticGpuVariant = 'raster-calcul' as never)],
    ['resolves compiling', (view) => Object.assign(view.gpu.temporal!, { upscales: () => false })],
  ];
  for (const [what, change] of changes) {
    const { rt } = runtime(0.5);
    change(rt);
    const size = sizeOf(rt);
    assert.deepEqual([size.renderWidth, size.apart], [3456, false], what);
  }
});

test('a quiet image draws at the maximum, a moving one at the scale asked', () => {
  const { rt } = runtime('auto');
  assert.equal(imageScale(rt, true), 1, 'the held image is the native one');
  assert.equal(imageScale(rt, false), 1, 'the controller starts at its maximum');
  const fixed = runtime(0.6).rt;
  assert.deepEqual([imageScale(fixed, true), imageScale(fixed, false)], [0.6, 0.6]);
  const bounded = runtime({ min: 0.5, max: 0.8 }).rt;
  assert.equal(imageScale(bounded, true), 0.8);
});

test('a scale change draws in the targets in place, the Hi-Z pyramid over the same size', () => {
  const { rt, extents } = runtime('auto');
  drawFrameAt(rt, 0.5);
  assert.deepEqual(rt.gpu.targetSize, [1728, 1120]);
  assert.deepEqual(rt.gpu.allocatedSize, DISPLAY, 'nothing remade');
  assert.equal(rt.scale.drawn, 0.5, 'the read-back is the scale drawn');
  drawFrameAt(rt, 1);
  assert.deepEqual(rt.gpu.targetSize, DISPLAY);
  assert.equal(rt.scale.drawn, 1);
  assert.deepEqual(extents, [[1728, 1120], DISPLAY]);
});

test('a fixed scale is honoured, and targets without a display apart draw whole', () => {
  const fixed = runtime(0.6, [2072, 1344]).rt;
  drawFrameAt(fixed, imageScale(fixed, false));
  assert.deepEqual(fixed.gpu.targetSize, [2072, 1344]);
  assert.equal(fixed.scale.drawn, 0.6);
  const whole = runtime('auto', DISPLAY, false).rt;
  drawFrameAt(whole, 0.5);
  assert.deepEqual(whole.gpu.targetSize, DISPLAY, 'no display colour to reconstruct into');
  assert.equal(whole.scale.drawn, 1);
});

test('lines keep their display width and textures their display density below the display', () => {
  const half = runtime(0.5).rt;
  drawFrameAt(half, 0.5);
  assert.equal(renderPixelRatio(half), 1, 'two CSS pixels of the display are one of the render');
  assert.equal(renderMipBias(half), -1);
  const native = runtime(1, DISPLAY, false).rt;
  assert.equal(renderPixelRatio(native), 2, "the host's ratio, to the bit");
  assert.equal(renderMipBias(native), 0);
});
