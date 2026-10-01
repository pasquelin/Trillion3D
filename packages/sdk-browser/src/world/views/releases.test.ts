import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerViews } from './explorerViews.ts';
import { createExplorerLifecycle } from '../session/lifecycle.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
const camera = () => hostFramingCamera(60, 1, 0.1, 100);
const rect = { x: 0, y: 0, width: 100, height: 100 };

function fixture(late = false, failing = false) {
  const admission = deferred(),
    release = deferred(),
    events: string[] = [];
  let calls = 0;
  const backend = {
    id: 'webgpu-page-raster',
    async addView() {
      if (late) await admission.promise;
      const number = calls++;
      return {
        resize() {},
        render() {},
        release() {
          if (failing && number === 0) throw new Error('lost-device');
          return (async () => {
            events.push('release-start');
            await release.promise;
            events.push('release-done');
          })();
        },
      };
    },
    dispose() {
      events.push('backend');
    },
  };
  const manager = createExplorerViews({
    active: () => backend,
    check() {},
    options: {},
    compose: {},
  } as unknown as Parameters<typeof createExplorerViews>[0]);
  const state = { active: backend };
  const lifecycle = createExplorerLifecycle(
    {
      options: {},
      callerOwned: true,
      diagnose() {},
      diagnosticChannel: { flushSync() {}, close() {} },
    } as unknown as Parameters<typeof createExplorerLifecycle>[0],
    {
      state,
      profiler: { dispose() {} },
      hostedControls: [
        {
          dispose() {
            events.push('controls');
          },
        },
      ],
      disposeComposition: manager.dispose,
      streaming: {},
      streamer: { dispose() {} },
      overlays: [],
      backends: [backend],
      gpuDevice: {
        destroy() {
          events.push('device');
        },
      },
    } as unknown as Parameters<typeof createExplorerLifecycle>[1],
  );
  return { manager, lifecycle, events, admission, release };
}

test('a removed view finishes its GPU release before its world releases the backend and device', async () => {
  const f = fixture();
  const view = await f.manager.add(camera(), rect);
  void view.dispose();
  const closing = f.lifecycle.dispose();
  assert.deepEqual(f.events, ['release-start', 'controls'], 'controls stop synchronously');
  assert.equal(f.lifecycle.dispose(), closing, 'repeated teardown joins the same drain');
  await Promise.resolve();
  assert.ok(!f.events.includes('backend'));
  f.release.resolve();
  await closing;
  assert.deepEqual(f.events, ['release-start', 'controls', 'release-done', 'backend', 'device']);
});

test('world disposal also drains a view whose GPU admission completes after teardown starts', async () => {
  const f = fixture(true);
  const opening = f.manager.add(camera(), rect);
  const rejected = assert.rejects(opening, /VIEW_RELEASED/);
  const closing = f.lifecycle.dispose();
  f.admission.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(!f.events.includes('backend'));
  f.release.resolve();
  await rejected;
  await closing;
  assert.deepEqual(f.events, ['controls', 'release-start', 'release-done', 'backend', 'device']);
});

test('a throwing view release cannot prevent another view or the backend from being released', async () => {
  const f = fixture(false, true);
  await f.manager.add(camera(), rect);
  await f.manager.add(camera(), rect);
  const closing = f.lifecycle.dispose();
  await Promise.resolve();
  assert.ok(!f.events.includes('backend'));
  f.release.resolve();
  await closing;
  assert.deepEqual(f.events, ['controls', 'release-start', 'release-done', 'backend', 'device']);
});
