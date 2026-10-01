import test from 'node:test';
import assert from 'node:assert/strict';
import { createXrFeatures } from './features.ts';
import { XrSessionEmulator, transform, xrFrame } from './session.fixture.ts';
import type { XrHitSource, XrSession } from './platform.ts';

test('hit tests use the current reference space and release sources once', async () => {
  const current = new XrSessionEmulator();
  let cancelled = 0;
  const source = { cancel: () => cancelled++ };
  const session = Object.assign(current, { requestHitTestSource: async () => source });
  const features = createXrFeatures(
    () => session,
    () => session.space,
    () => {},
  );
  const received: unknown[] = [];
  const stop = await features.api.hitTest((hits) => received.push(hits));
  const frame = xrFrame(session),
    moved = new XrSessionEmulator().space;
  frame.getHitTestResults = (asked) => {
    assert.equal(asked, source);
    return [
      {
        getPose(space) {
          assert.equal(space, moved);
          return { transform: transform(7) };
        },
      },
    ];
  };
  features.frame(frame, moved);
  assert.equal((received[0] as ReturnType<typeof transform>[])[0].position.x, 7);
  stop();
  stop();
  features.clear();
  assert.equal(cancelled, 1);
});

test('a hit source arriving after session closure is cancelled, never published', async () => {
  let resolve!: (source: XrHitSource) => void;
  let cancelled = 0;
  const current = Object.assign(new XrSessionEmulator(), {
    requestHitTestSource: () =>
      new Promise<XrHitSource>((done) => {
        resolve = done;
      }),
  });
  let session: XrSession | null = current;
  const features = createXrFeatures(
    () => session,
    () => current.space,
    () => {},
  );
  const opening = features.api.hitTest(() => assert.fail('ended source must not notify'));
  await Promise.resolve();
  session = null;
  features.clear();
  resolve({ cancel: () => cancelled++ });
  await assert.rejects(opening, /XR_SESSION_ENDED/);
  assert.equal(cancelled, 1);
});

test('teleport passes the inverse rigid transform into the current reference space', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XRRigidTransform');
  const session = new XrSessionEmulator(),
    inverse = transform(-3),
    shifted = new XrSessionEmulator().space;
  let replaced = false;
  class Transform {
    inverse = inverse;
    constructor(position: { x: number }, rotation: { y: number; w: number }) {
      assert.equal(position.x, 3);
      assert.ok(Math.abs(rotation.y - 1) < 1e-12);
      assert.ok(Math.abs(rotation.w) < 1e-12);
    }
  }
  Object.defineProperty(globalThis, 'XRRigidTransform', { configurable: true, value: Transform });
  session.space.getOffsetReferenceSpace = (value) => {
    assert.equal(value, inverse);
    return shifted;
  };
  try {
    const features = createXrFeatures(
      () => session,
      () => session.space,
      (next) => {
        assert.equal(next, shifted);
        replaced = true;
      },
    );
    features.api.teleport({ x: 3, y: 0, z: 0 }, Math.PI);
    assert.equal(replaced, true);
    assert.throws(() => features.api.teleport({ x: NaN, y: 0, z: 0 }), /XR_TELEPORT/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'XRRigidTransform', previous);
    else Reflect.deleteProperty(globalThis, 'XRRigidTransform');
  }
});
