import test from 'node:test';
import assert from 'node:assert/strict';
import { worldXr } from './world.ts';
import { XrSessionEmulator, xrFrame } from './session.fixture.ts';
import type { MeasuredWorld } from '../session/explorer.ts';

const turn = () => new Promise<void>((done) => setImmediate(done));

test('entry before renderer readiness requests no grant; ready WebGPU entry keeps activation and mandatory feature', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requested = 0;
  const refused = new Error('permission refused');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      xr: {
        requestSession(_mode: string, options: { requiredFeatures: string[] }) {
          requested++;
          assert.ok(options.requiredFeatures.includes('webgpu'));
          return Promise.reject(refused);
        },
      },
    },
  });
  const device = { ready: Promise.resolve(), renderer: null as string | null, xrCompatible: true };
  const runtime = { explorer: null, settled: async () => {}, render() {}, invalidate() {} };
  const { xr } = worldXr(
    runtime,
    device,
    () => {},
    () => {},
  );
  try {
    const early = xr.enterVR();
    assert.equal(requested, 0);
    await assert.rejects(early, /XR_WORLD_NOT_READY/);
    device.renderer = 'webgpu';
    const entered = xr.enterVR();
    assert.equal(requested, 1, 'requestSession runs synchronously in the user action');
    await assert.rejects(entered, refused);
  } finally {
    xr.dispose();
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

for (const endFirst of [false, true])
  test(`reopen waits for XR resources without deadlocking an opening (browser ended: ${endFirst})`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const session = new XrSessionEmulator();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { xr: { requestSession: async () => session } },
    });
    let settled!: () => void,
      release!: () => void,
      draws = 0;
    const pending = new Promise<void>((done) => (settled = done));
    const disposed = new Promise<void>((done) => (release = done));
    const order: string[] = [];
    const owner = {
      setXrActive(active: boolean) {
        order.push(`active:${active}`);
      },
      openXr: async () => ({
        draw: () => draws++,
        dispose: () => {
          order.push('release-start');
          return disposed.then(() => {
            order.push('release-end');
          });
        },
      }),
    } as unknown as MeasuredWorld;
    const runtime = {
      explorer: null as MeasuredWorld | null,
      settled: () => pending,
      render() {},
      invalidate() {},
    };
    const managed = worldXr(
      runtime,
      { ready: Promise.resolve(), renderer: 'webgl2' },
      () => {},
      (error) => order.push((error as Error).message),
    );
    try {
      const opening = managed.xr.enterVR();
      await turn();
      await managed.closing();
      assert.equal(session.ended, 0, 'an opening with no owner may settle on the next renderer');
      runtime.explorer = owner;
      settled();
      await opening;
      session.tick(xrFrame(session));
      assert.equal(draws, 1);
      if (endFirst) await session.end();
      let closed = false;
      const closing = Promise.resolve(managed.closing()).then(() => {
        closed = true;
        order.push('renderer-dispose');
      });
      await turn();
      assert.equal(closed, false);
      assert.equal(managed.xr.session, null);
      session.tick(xrFrame(session));
      assert.equal(draws, 1, 'no frame can reach the old renderer during disposal');
      release();
      await closing;
      assert.ok(order.indexOf('release-end') < order.indexOf('renderer-dispose'));
      if (!endFirst) assert.ok(order.some((message) => message.startsWith('XR_WORLD_REOPENED')));
    } finally {
      managed.xr.dispose();
      if (previous) Object.defineProperty(globalThis, 'navigator', previous);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });

for (const exitFirst of [false, true])
  test(`world release waits for XR views (exit first: ${exitFirst})`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const session = new XrSessionEmulator();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { xr: { requestSession: async () => session } },
    });
    let free!: () => void;
    const releasing = new Promise<void>((done) => (free = done));
    let paused = false,
      released = false;
    const owner = {
      setXrActive: (value: boolean) => {
        paused = value;
      },
      openXr: async () => ({ draw() {}, dispose: () => releasing }),
    } as unknown as MeasuredWorld;
    const runtime = { explorer: owner, settled: async () => {}, render() {}, invalidate() {} };
    const device = { ready: Promise.resolve(), renderer: 'webgl2' };
    const plain = worldXr(
      runtime,
      device,
      () => {},
      (error) => assert.fail(String(error)),
    );
    plain.release(() => {
      released = true;
    });
    assert.equal(released, true);
    released = false;
    const immersive = worldXr(
      runtime,
      device,
      () => {},
      (error) => assert.fail(String(error)),
    );
    try {
      await immersive.xr.enterVR();
      const exiting = exitFirst ? immersive.xr.exit() : undefined;
      assert.equal(
        immersive.release(() => {
          released = true;
        }),
        undefined,
      );
      assert.equal(paused, true, 'ordinary loop stays stopped while XR resources are releasing');
      assert.equal(released, false);
      free();
      await exiting;
      await turn();
      assert.equal(released, true);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
