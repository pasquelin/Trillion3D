import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldXr } from './session.ts';
import { XrSessionEmulator, xrFrame } from './session.fixture.ts';
import type { XrSession, XrSpace } from './platform.ts';

const turn = () => new Promise(setImmediate);

test('XR draws both browser views once per headset frame and releases on browser end', async () => {
  const session = new XrSessionEmulator(),
    active: boolean[] = [],
    eyes: string[][] = [];
  let released = 0;
  const xr = createWorldXr({
    system: () => ({ isSessionSupported: async () => true, requestSession: async () => session }),
    active: (on) => active.push(on),
    failed: (e) => assert.fail(String(e)),
    open: async () => ({
      draw: (_frame, _space, views) => {
        eyes.push(views.map((view) => view.eye));
      },
      dispose: () => {
        released++;
      },
    }),
  });
  await xr.enterVR();
  assert.equal(xr.session, session);
  session.tick(xrFrame(session));
  assert.deepEqual(eyes, [['left', 'right']]);
  session.visibilityState = 'hidden';
  session.tick(xrFrame(session));
  assert.equal(eyes.length, 1);
  await session.end();
  assert.equal(session.callbacks.size, 0);
  assert.equal(xr.session, null);
  assert.equal(released, 1);
  assert.deepEqual(active, [true, false]);
  xr.dispose();
  assert.equal(released, 1);
});

test('exiting during a pending grant closes it without opening a renderer', async () => {
  const session = new XrSessionEmulator();
  let grant!: (session: XrSession) => void;
  const xr = createWorldXr({
    system: () => ({
      isSessionSupported: async () => true,
      requestSession: () =>
        new Promise((done) => {
          grant = done;
        }),
    }),
    active() {},
    failed: (e) => assert.fail(String(e)),
    open: async () => {
      throw new Error('must not open');
    },
  });
  const entering = xr.enterAR(),
    exiting = xr.exit();
  grant(session);
  await Promise.all([entering, exiting]);
  assert.equal(session.ended, 1);
  assert.equal(xr.session, null);
});

test('a renderer created after a browser end is released, and a failed frame ends the session', async () => {
  const session = new XrSessionEmulator(),
    errors: unknown[] = [];
  let finish!: (drawing: { draw(): void; dispose(): void }) => void,
    disposed = 0;
  const xr = createWorldXr({
    system: () => ({ isSessionSupported: async () => true, requestSession: async () => session }),
    active() {},
    failed: (e) => errors.push(e),
    open: () =>
      new Promise((done) => {
        finish = done;
      }),
  });
  const entering = xr.enterVR();
  await turn();
  await session.end();
  finish({
    draw() {},
    dispose: () => {
      disposed++;
    },
  });
  await entering;
  assert.equal(disposed, 1);
  const again = xr.enterVR();
  await turn();
  const failure = new Error('XR render failed');
  finish({
    draw() {
      throw failure;
    },
    dispose: () => {
      disposed++;
    },
  });
  await again;
  session.tick(xrFrame(session));
  await turn();
  assert.deepEqual(errors, [failure]);
  assert.equal(disposed, 2);
  assert.equal(session.callbacks.size, 0);
});

test('input nodes retain identity, hide on tracking loss and detach when a source leaves', async () => {
  const session = new XrSessionEmulator(),
    space = session.space;
  const source = {
    handedness: 'left' as const,
    targetRayMode: 'tracked-pointer' as const,
    targetRaySpace: space,
    gripSpace: space,
    profiles: [],
    hand: new Map([['wrist', space]]),
  };
  session.inputSources = [source];
  const xr = createWorldXr({
    system: () => ({ isSessionSupported: async () => true, requestSession: async () => session }),
    active() {},
    failed: (e) => assert.fail(String(e)),
    open: async () => ({ draw() {}, dispose() {} }),
  });
  await xr.enterVR();
  const input = xr.inputs[0];
  session.tick(xrFrame(session));
  assert.equal(input.ray.position.x, 3);
  assert.equal(input.joints.get('wrist')!.position.x, 4);
  assert.equal(input.joints.get('wrist')!.userData.radius, 0.01);
  session.tick(xrFrame(session, false));
  assert.equal(input.ray.visible, false);
  assert.equal(xr.inputs[0], input);
  xr.setReferenceSpace(new EventTarget() as XrSpace);
  session.inputSources = [];
  session.dispatchEvent(new Event('inputsourceschange'));
  assert.deepEqual(xr.inputs, []);
  await xr.exit();
});
