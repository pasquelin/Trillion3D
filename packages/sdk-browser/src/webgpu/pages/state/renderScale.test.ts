import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameSizeOf,
  renderExtent,
  renderMipBias,
  renderPixelRatio,
  renderScaleOf,
  sessionRenderScale,
  type FrameSize,
} from './renderScale.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A view that accumulates in the beauty view at `scale`, its targets `render` for `display`. */
function runtime(scale: number, render = [1728, 1120], display = [3456, 2234]) {
  return {
    setup: { viewport: display, pixelRatio: () => 2 },
    context: { renderScale: scale },
    gpu: {
      temporal: {},
      temporalWanted: true,
      targetSize: render,
      displaySize: display,
    },
    run: { diagnostic: 'beauty' },
    vis: { visEnabled: true },
  } as unknown as WebgpuPagesRuntime;
}

test('the session scale is the host fraction in [0.5, 1], the display when absent', () => {
  assert.equal(sessionRenderScale(undefined), 1);
  assert.equal(sessionRenderScale(Number.NaN), 1);
  assert.equal(sessionRenderScale(1.5), 1);
  assert.equal(sessionRenderScale(0.67), 0.67);
  assert.equal(sessionRenderScale(0.1), 0.5);
});

test('a render axis is the display at native size, else a multiple of eight', () => {
  assert.equal(renderExtent(1117, 1), 1117, 'native size keeps an odd axis as it is');
  assert.equal(renderExtent(3456, 0.5), 1728);
  assert.equal(renderExtent(2234, 0.5), 1120);
  assert.equal(renderExtent(3456, 0.67), 2312);
  assert.equal(renderExtent(12, 0.5), 8, 'never below eight');
});

// #816: only where the temporal resolve reconstructs the display is the frame drawn below it.
test('the frame is drawn below the display only when the temporal resolve reconstructs it', () => {
  const rt = runtime(0.5);
  const size = frameSizeOf(rt, {} as FrameSize);
  assert.deepEqual(size, { width: 3456, height: 2234, renderWidth: 1728, renderHeight: 1120 });
  assert.equal(renderScaleOf(rt), 0.5);
  const changes: [string, (view: WebgpuPagesRuntime) => void][] = [
    ['a diagnostic view', (view) => (view.run.diagnostic = 'normals' as never)],
    ['the pass switched off', (view) => (view.gpu.temporalWanted = false)],
    ['no pass: a capture view', (view) => (view.gpu.temporal = undefined)],
    ['the fallback draw', (view) => (view.vis.visEnabled = false)],
  ];
  for (const [what, change] of changes) {
    const view = runtime(0.5);
    change(view);
    assert.equal(renderScaleOf(view), 1, what);
  }
  assert.equal(renderScaleOf(runtime(1)), 1);
});

test('lines keep their display width and textures their display density below the display', () => {
  const half = runtime(0.5, [1728, 1120]);
  assert.equal(renderPixelRatio(half), 1, 'two CSS pixels of the display are one of the render');
  assert.equal(renderMipBias(half), -1);
  const native = runtime(1, [3456, 2234]);
  assert.equal(renderPixelRatio(native), 2, "the host's ratio, to the bit");
  assert.equal(renderMipBias(native), 0);
});
