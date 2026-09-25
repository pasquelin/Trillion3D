import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createWorldFrames, NOT_DRAWN } from './worldFrames.ts';
import { createExplorerMetrics } from '../diagnostic/metrics.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';

test('the first frame after a pause spans at most two of the intervals the loop measured', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const frames = createWorldFrames();
  const deltas: number[] = [];
  frames.add((frame) => deltas.push(frame.delta));
  for (const at of [1500, 1516, 1532]) {
    now = at;
    frames.dispatch({ ...NOT_DRAWN });
  }
  // The first frame spans nothing; the running loop's own interval is kept as measured.
  assert.deepEqual(deltas, [0, 0.016, 0.016]);
  now = 6532; // Five seconds of a still scene, or of a hidden tab.
  frames.advance();
  now = 11532;
  assert.equal(frames.advance(), 0.032);
  frames.dispatch({ ...NOT_DRAWN });
  assert.equal(deltas.at(-1), 0.032);
});

test('the controllers integrate from step to step, the render time included', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const frames = createWorldFrames();
  const stepped: number[] = [];
  for (const at of [1000, 1016, 1032]) {
    now = at;
    stepped.push(frames.advance());
    now = at + 5; // The frame renders for 5 ms before it is dispatched.
    frames.dispatch({ ...NOT_DRAWN });
  }
  assert.deepEqual(stepped, [0, 0.016, 0.016]);
});

test('a frame steps the controls, then the before hooks, then draws, then the after hooks', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const frames = createWorldFrames();
  const scene = new Object3D(),
    eye = new Object3D(),
    body = new Object3D();
  scene.add(body);
  const order: string[] = [];
  const controls = {
    autoUpdate: true,
    update(delta: number) {
      order.push('controls');
      eye.position.x += delta;
    },
  };
  // The body rides the eye: placed ahead of the frame, it is drawn at the pose of this frame.
  const stop = frames.before(({ delta }) => {
    order.push(`before ${delta}`);
    body.position.copy(eye.position);
  });
  frames.add(() => order.push('after'));
  const drawn: number[] = [];
  for (const at of [1000, 1016]) {
    now = at;
    frames.step(controls, scene);
    drawn.push(body.position.x - eye.position.x);
    order.push('draw');
    frames.dispatch({ ...NOT_DRAWN });
  }
  assert.deepEqual(drawn, [0, 0]);
  assert.equal(eye.position.x, 0.016);
  assert.deepEqual(order.slice(0, 8), [
    ...['controls', 'before 0', 'draw', 'after'],
    ...['controls', 'before 0.016', 'draw', 'after'],
  ]);
  // A page that takes the controller's step is never stepped by the loop; a removed hook stops.
  controls.autoUpdate = false;
  stop();
  order.length = 0;
  frames.step(controls, scene);
  assert.deepEqual(order, []);
});

test('the GPU frame time the engine measured reaches the page hook; an unmeasured one reads null', () => {
  // The host's own path, without a browser: the engine's `metrics()`, copied key by key through
  // `BACKEND_METRIC_KEYS` into the host sample, dispatched to the world's frame hook.
  const streamer = {
    stats: () => ({
      evictions: 0,
      loaded: 0,
      bytesRead: 0,
      requested: 0,
      loading: 0,
      hits: 0,
      misses: 0,
    }),
  } as unknown as ReturnType<typeof createPageStreamer>;
  const { metricsScratch, fillMetrics } = createExplorerMetrics(
    {} as ClusterManifest,
    {} as MeasuredWorldOptions,
    streamer,
    0,
    0,
    () => ({ loaded: 0, pageBytesRead: 0, streamingError: null, effectBytes: 0 }),
  );
  const frames = createWorldFrames();
  const seen: (number | null | undefined)[] = [];
  frames.add((frame) => seen.push(frame.metrics.gpuFrameMs));
  for (const published of [{ gpuFrameMs: 3.2 }, {}]) {
    fillMetrics({ metrics: () => published } as unknown as RenderBackend);
    frames.dispatch(metricsScratch);
  }
  assert.deepEqual(seen, [3.2, null]);
});
