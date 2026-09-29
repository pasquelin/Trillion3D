import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { WaterSurface } from '../packages/sdk-core/src/fluids/waterSurface.ts';
import type { WaterSpec } from '../packages/sdk-core/src/fluids/buoyancy.ts';
import { dynamicWorld } from '../packages/sdk-browser/src/world/core/worldDynamic.fixture.ts';
import { seeded } from '../site/examples/kit/random.ts';
import { roadmapEntries } from '../site/app/examples/list.ts';

type Hook = () => void;
type Spec = unknown[] | boolean | (() => void);

/**
 * Runs an example page's module in Node on the engine's own scene objects, drawn by a world
 * runtime on a session stand-in (`dynamicWorld`): what the page writes each frame reaches the
 * world as it would in a browser. A shape written every frame used to be cut again and to open
 * the session again, the blank render of #522; it is now uploaded in place (#573).
 */
async function runOnWorld(html: string) {
  const world = dynamicWorld();
  let surface: WaterSurface | null = null,
    time = 0;
  const frames: Hook[] = [];
  const createWorld = () => ({
    scene: world.scene,
    camera: { position: { set() {} } },
    controls: { target: { set() {} } },
    physics: {
      timeScale: 1,
      set water(spec: WaterSpec) {
        surface = new WaterSurface(spec);
      },
      get waterSurface() {
        return surface?.setTime(time) ?? null;
      },
    },
    onFrame: (hook: Hook) => frames.push(hook),
    invalidate() {},
  });
  // The kit's panel, without a document: its values at their defaults, told once.
  const controls = (specs: Record<string, Spec>, onChange: (values: object) => void) => {
    const values = Object.fromEntries(
      Object.entries(specs)
        .filter(([, spec]) => typeof spec !== 'function')
        .map(([key, spec]) => [key, Array.isArray(spec) ? spec[2] : spec]),
    );
    onChange(values);
    return values;
  };
  const modules = {
    engine: { createWorld, geometry, material, object, light, math },
    kit: { controls, physicsReadouts: () => {}, seeded },
  };
  await runExampleModule(html, modules);
  /** Draws one frame at `seconds`, then runs the page's frame hooks, which write its sea. */
  const frame = async (seconds: number) => {
    await world.frame();
    time = seconds;
    for (const hook of frames) hook();
  };
  return { world, frame };
}

test('floating crates rewrites its sea every frame in place: no recut, no session opened again', async () => {
  const crates = roadmapEntries.find(({ id }) => id === 'floating-crates');
  assert.ok(crates?.file && !crates.status, 'floating crates is a ready example');
  const html = await readFile(new URL(`../site/${crates.file}`, import.meta.url), 'utf8');
  const { world, frame } = await runOnWorld(html);
  await frame(0);
  await frame(0.05);
  const served = world.served.count;
  for (let second = 0.1; second < 1; second += 0.05) await frame(second);
  await world.frame();
  world.end();
  assert.equal(world.served.count, served, 'no page cut or served again');
  assert.equal(world.sources.length, 1, 'one session');
  assert.ok(world.rewrites.length >= 18, `${world.rewrites.length} rewrites of the sea`);
  const names = new Set(world.rewrites.flat().map(({ name }) => name));
  assert.deepEqual([...names].sort(), ['normal', 'position'], 'the sea moves, and its shading');
});
