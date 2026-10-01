import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { createWorldRuntime } from './worldRuntime.ts';
import { sessionStandIn, type Open } from './worldRuntime.fixture.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import { capability } from '../capability/index.ts';
import { diagnostic } from '../diagnostic/index.ts';
import { capture } from '../capture/index.ts';
import { registerWorld } from './worldSession.ts';
import { Scene } from './scene.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** A session drawn synchronously at opening, as the interactive renderer does. */
function openingWorld(onFrame: (world: object, id: number) => void) {
  const scene = new Scene(() => Promise.reject(new Error('no loader'))),
    world = {};
  const failures: unknown[] = [],
    disposed: number[] = [];
  let settingsApplied = false,
    opened = 0;
  const open: Open = async (_canvas, options) => {
    const id = ++opened,
      { session } = sessionStandIn();
    Object.assign(session, {
      lightingCapabilities: () => id,
      partitionAudit: () => id,
      captureView: async () => new Uint8Array([id, 0, 0, 255]),
      dispose: () => disposed.push(id),
    });
    settingsApplied = false;
    options.onFrame?.({ frame: id } as unknown as FrameMetrics);
    return session as unknown as MeasuredWorld;
  };
  const runtime = createWorldRuntime({
    canvas: { width: 1, height: 1 } as HTMLCanvasElement,
    scene,
    camera: () => new Camera('perspective'),
    ready: async () => {},
    open,
    options: () => ({
      manifestUrl: '',
      onFrame() {
        assert.equal(settingsApplied, true, 'host settings precede the frame observer');
        onFrame(world, opened);
      },
    }),
    opened: () => {
      settingsApplied = true;
    },
    frame() {},
    drawn: () => opened > 0,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), opening() {}, failed: (e) => failures.push(e) },
  });
  registerWorld(
    world,
    { session: () => runtime.explorer as MeasuredWorld | null, last: () => null },
    { particles: [] },
  );
  return { runtime, scene, failures, disposed };
}

test('the first frame exposes its owned session to capability, diagnostic and capture', async () => {
  const captures: Promise<unknown>[] = [],
    seen: number[] = [];
  const { runtime, scene, failures } = openingWorld((world, id) => {
    assert.equal(capability.lighting(world), id);
    assert.equal(diagnostic.partitionAudit(world), id);
    seen.push(id);
    captures.push(
      capture
        .buffer(world, { width: 1, height: 1 })
        .then(({ data }) => assert.deepEqual([...data], [id, 0, 0, 255])),
    );
  });
  try {
    scene.add(object.mesh(geometry.box()));
    await runtime.settled();
    await Promise.all(captures);
    assert.deepEqual(seen, [1]);
    runtime.renew('option');
    await runtime.settled();
    await Promise.all(captures);
    assert.deepEqual(seen, [1, 2], 'each replacement session reports its first frame once');
    assert.deepEqual(failures, []);
  } finally {
    runtime.dispose();
  }
});

for (const failAt of [1, 2])
  test(`a throwing first frame of session ${failAt} reports failure and releases that session`, async () => {
    const failure = new Error('host frame failed');
    const { runtime, scene, failures, disposed } = openingWorld((_world, id) => {
      if (id === failAt) throw failure;
    });
    try {
      scene.add(object.mesh(geometry.box()));
      await runtime.settled();
      if (failAt === 2) {
        assert.deepEqual(failures, []);
        runtime.renew('option');
        await runtime.settled();
      }
      assert.deepEqual(failures, [failure]);
      assert.equal(runtime.explorer, null, 'a failed opening leaves no running session');
      assert.deepEqual(disposed, failAt === 1 ? [1] : [1, 2]);
    } finally {
      runtime.dispose();
    }
    assert.equal(disposed.length, failAt, 'the failed session is disposed exactly once');
  });
