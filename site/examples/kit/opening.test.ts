import assert from 'node:assert/strict';
import test from 'node:test';
import { circling, ease, flights, opening } from './opening.ts';

/** A world whose frames and canvas events the test fires by hand. */
function fakeWorld() {
  const hooks: ((frame: { delta: number }) => void)[] = [];
  const listeners = new Map<string, () => void>();
  let updates = 0;
  return {
    world: {
      canvas: {
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      },
      onFrame: (hook: (frame: { delta: number }) => void) => hooks.push(hook),
      invalidate: () => {},
      controls: { update: () => updates++ },
    },
    frame: (delta: number) => hooks.forEach((hook) => hook({ delta })),
    press: (type: string) => listeners.get(type)?.(),
    updates: () => updates,
  };
}

test('an opening poses at once, counts at most 50 ms a frame, and lands when the pose says so', () => {
  const fake = fakeWorld();
  const times: number[] = [];
  const glide = opening(fake.world as never, (time) => (times.push(time), time < 0.1));
  fake.frame(0.02);
  fake.frame(1);
  fake.frame(0.05);
  fake.frame(0.05);
  assert.deepEqual(
    times.map((time) => Math.round(time * 1000)),
    [0, 20, 70, 120],
  );
  assert.equal(glide.gliding, false);
  assert.equal(fake.updates(), 4);
  glide.restart();
  assert.equal(glide.gliding, true);
  assert.equal(times.at(-1), 0);
});

test("the viewer's first press or wheel ends the opening where it is", () => {
  for (const type of ['pointerdown', 'wheel']) {
    const fake = fakeWorld();
    let poses = 0;
    const glide = opening(fake.world as never, () => void poses++);
    fake.press(type);
    fake.frame(0.02);
    assert.equal(glide.gliding, false);
    assert.equal(poses, 1);
  }
});

test('the easings run from 0 to 1, clamped outside', () => {
  for (const curve of Object.values(ease)) {
    assert.equal(curve(-1), 0);
    assert.equal(curve(0), 0);
    assert.equal(curve(1), 1);
    assert.equal(curve(2), 1);
    assert.ok(curve(0.25) < curve(0.5) && curve(0.5) < curve(0.75));
  }
  assert.equal(ease.smooth(0.5), 0.5);
  assert.equal(ease.inOut(0.5), 0.5);
});

test('circling turns the camera round the target from where it stood, at its height', () => {
  const fake = fakeWorld();
  const position = {
    x: 3,
    y: 2,
    z: 1,
    set(x: number, y: number, z: number) {
      Object.assign(position, { x, y, z });
    },
  };
  const world = {
    ...fake.world,
    camera: { position },
    controls: { update: () => {}, target: { x: 1, y: 0, z: 1 } },
  };
  circling(world as never, Math.PI);
  assert.deepEqual([position.x, position.y, position.z], [3, 2, 1]);
  for (let frame = 0; frame < 10; frame++) fake.frame(0.05);
  // Half a second at π a second: a quarter turn, clockwise seen from above (+X to -Z).
  assert.ok(Math.abs(position.x - 1) < 1e-9 && Math.abs(position.z + 1) < 1e-9);
  assert.equal(position.y, 2);
});

test('a flight eases from where the camera stands to the view asked for, then lands', () => {
  const fake = fakeWorld();
  const movable = (x: number, y: number, z: number) => {
    const point = {
      x,
      y,
      z,
      set(a: number, b: number, c: number) {
        Object.assign(point, { x: a, y: b, z: c });
      },
    };
    return point;
  };
  const position = movable(0, 0, 10),
    target = movable(0, 0, 0);
  const world = { ...fake.world, camera: { position }, controls: { update: () => {}, target } };
  const flyTo = flights(world as never);
  fake.frame(0.05);
  assert.deepEqual([position.x, position.z], [0, 10]);
  flyTo({ position: [4, 2, 6], target: [1, 1, 1] }, 0.1);
  fake.frame(0.05);
  assert.deepEqual([position.x, position.y, position.z], [2, 1, 8]);
  fake.frame(0.05);
  fake.frame(0.05);
  assert.deepEqual([position.x, position.y, position.z, target.x, target.y, target.z], [4, 2, 6, 1, 1, 1]);
});
