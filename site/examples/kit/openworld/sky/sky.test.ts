import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fakeEngine } from './engine.fixture.ts';
import { createSky } from './sky.ts';

type Hook = (frame: { delta: number }) => void;

/** The page's world as the sky reads it: its hooks and the frames it was asked for, counted. */
function fakeWorld() {
  const engine = fakeEngine();
  const hooks = new Set<Hook>();
  const scene = { ...engine.object.group(), background: null, fog: null, environment: null };
  const world = {
    scene,
    camera: { ...engine.object.group(), far: 60_000, fov: 50 },
    exposure: 1,
    asked: 0,
    onFrame: (hook: Hook) => {
      hooks.add(hook);
      return () => hooks.delete(hook);
    },
    invalidate() {
      world.asked++;
    },
    frame: (delta: number) => hooks.forEach((hook) => hook({ delta })),
    hooks,
  };
  return { engine, world };
}

const sky = (world: ReturnType<typeof fakeWorld>['world'], engine: ReturnType<typeof fakeEngine>) =>
  createSky({ world, engine, seed: 332, size: 50_000, tile: 1_000, speed: 60 } as never);

describe('sky', () => {
  it("runs a whole day on the page's world: lights, exposure, night and rain", () => {
    const { engine, world } = fakeWorld();
    const moving = sky(world, engine);
    const seen = new Set<boolean>();
    moving.rain.amount = 1;
    for (let second = 0; second < 30; second++) {
      world.frame(1);
      seen.add(moving.isNight);
      assert.ok(Number.isFinite(world.exposure) && world.exposure > 0);
      assert.ok(moving.nightFactor >= 0 && moving.nightFactor <= 1);
    }
    assert.deepEqual([...seen].sort(), [false, true]);
    assert.ok(moving.rain.node.visible);
    assert.equal(moving.lampIntensity({ night: false, intensity: 5 } as never), 5);
  });

  // #402: the frame hook asked the world for a frame at every step, paused or not.
  it('asks for a frame only when its time is written, and disposes of what it added', () => {
    const { engine, world } = fakeWorld();
    const still = sky(world, engine);
    still.paused = true;
    for (let frame = 0; frame < 10; frame++) world.frame(1 / 60);
    assert.equal(world.asked, 0, 'a step asks for no frame of its own');
    still.time = 6;
    still.time = 6;
    assert.equal(world.asked, 1, 'a new time is drawn even in a still world');
    still.dispose();
    assert.equal(world.hooks.size, 0, 'unhooked from the frames');
    assert.deepEqual(world.scene.children, [], 'nothing left in the scene');
    assert.equal(world.scene.environment, null);
  });
});
