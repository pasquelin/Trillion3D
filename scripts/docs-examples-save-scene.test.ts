import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { geometry, helper, light, material, object } from '../packages/sdk-browser/src/index.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { ObjectPhysics } from '../packages/sdk-core/src/physics/objectPhysics.ts';
import type { Mesh } from '../packages/sdk-core/src/world/object/mesh.ts';

type Buttons = Record<'save' | 'knockDown' | 'open', () => unknown>;

/** Runs save-the-scene's module in Node on the engine's own scene, its buttons returned: the
 *  physics is not stepped here, so what a push leaves is written by the test. */
async function saveTheScene() {
  const html = await readFile(
    new URL('../site/examples/save-the-scene.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  let buttons = {} as Buttons;
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({ scene, camera, controls: { target: { set() {} } } }),
      geometry,
      material,
      object,
      light,
      helper,
    },
    kit: {
      controls: (specs: Buttons) => void (buttons = specs),
      readout: () => () => {},
      words:
        () =>
        (_key: string, { bytes }: { bytes: number }) =>
          `${bytes} bytes`,
    },
  });
  const blocks = () =>
    (scene.children as Mesh[])
      .filter((node) => node.physics?.type === 'dynamic')
      .sort((a, b) => a.position.y - b.position.y);
  const ground = (scene.children as Mesh[]).find((node) => node.physics?.type === 'static');
  return { scene, camera, buttons, blocks, ground };
}

/** The bottom and top of a mesh standing upright, from its shape's own bounds. */
function span(mesh: Mesh) {
  const { min, max } = mesh.localBounds()!;
  return [mesh.position.y + min.y, mesh.position.y + max.y];
}

test('save-the-scene stacks its blocks in contact, each on the one below, the lowest on the ground', async () => {
  const { blocks, ground } = await saveTheScene();
  assert.ok(ground);
  const stack = blocks();
  assert.equal(stack.length, 4);
  let top = span(ground)[1];
  for (const block of stack) {
    const [bottom, up] = span(block);
    assert.ok(
      Math.abs(bottom - top) < 1e-9,
      `a block starts at ${bottom}, the one below ends at ${top}`,
    );
    top = up;
  }
});

test('save-the-scene: saved standing, pushed down by impulses, opened standing again', async (t) => {
  const { scene, camera, buttons, blocks } = await saveTheScene();
  const pushes: [number, number, number][] = [];
  t.mock.method(ObjectPhysics.prototype, 'applyImpulse', (x: number, y: number, z: number) =>
    pushes.push([x, y, z]),
  );
  const poses = () => blocks().map(({ position: { x, y, z } }) => [x, y, z]);
  buttons.save();
  const standing = poses(),
    saved = JSON.stringify(scene.toJSON(camera));
  // The knock-down pushes every block, harder the higher it stands, and moves none itself.
  buttons.knockDown();
  assert.deepEqual(poses(), standing, 'no block is teleported');
  assert.equal(pushes.length, 4);
  for (const [k, [x, y, z]] of pushes.entries()) {
    assert.ok(x > (pushes[k - 1]?.[0] ?? 0) && y === 0 && z === 0, `push ${k}: ${x}, ${y}, ${z}`);
  }
  // What the fall leaves, as the physics' poses would write it: every block lying on the ground.
  for (const [k, block] of blocks().entries()) block.position.set(1 + k * 1.2, 0.25, 0.3 * k);
  assert.notEqual(
    JSON.stringify(scene.toJSON(camera)),
    saved,
    'the fallen scene is not the saved one',
  );
  await buttons.open();
  assert.deepEqual(poses(), standing, 'the tower stands again');
  for (const block of blocks())
    assert.equal(block.physics?.mass, 20, 'each block the body it was declared');
});
