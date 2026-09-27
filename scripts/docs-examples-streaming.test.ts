import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { light, math } from '../packages/sdk-browser/src/index.ts';
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { walkSpeed: number; memory: number; view: string };
type Specs = {
  walkSpeed: readonly [number, number, number, number];
  memory: readonly [number, number, number, number];
  view: readonly string[];
  home: () => void;
};

test('city walk uses the native pages and applies its public navigation and memory controls', async () => {
  const html = await readFile(
    new URL('../site/examples/a-walk-through-the-city.html', import.meta.url),
    'utf8',
  );
  const camera = new Camera('perspective');
  const loaded: string[] = [];
  const controls = {
    movementSpeed: 0,
    followCalls: 0,
    follow() {
      this.followCalls++;
    },
  };
  const budget = { geometryPool: 0 };
  const diagnostic = { mode: '' };
  let change = (_values: Values) => {};
  let buttons = {} as Pick<Specs, 'home'>;
  let createdWith = '';
  await runExampleModule(html, {
    engine: {
      createWorld: (_target: string, options: { controls: string }) => {
        createdWith = options.controls;
        return {
          scene: {
            background: null,
            add() {},
            async load(url: string) {
              loaded.push(url);
            },
          },
          camera,
          controls,
          budget,
          diagnostic,
          invalidate() {},
        };
      },
      light,
      math,
    },
    kit: {
      controls(specs: Specs, callback: typeof change) {
        buttons = specs;
        change = callback;
        callback({
          walkSpeed: specs.walkSpeed[2],
          memory: specs.memory[2],
          view: specs.view[0],
        });
      },
    },
  });

  assert.equal(createdWith, 'firstPerson');
  assert.deepEqual(loaded, [
    '../assets/examples/detail-by-pixel-error/cache/native/full/manifest.json',
  ]);
  assert.equal(controls.movementSpeed, 0.45);
  assert.equal(budget.geometryPool, 768 * 1024);
  assert.equal(diagnostic.mode, 'beauty');
  const home = {
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
  };

  change({ walkSpeed: 1.25, memory: 128, view: 'lod' });
  assert.equal(controls.movementSpeed, 1.25);
  assert.equal(budget.geometryPool, 128 * 1024);
  assert.equal(diagnostic.mode, 'lod');
  camera.position.set(9, 8, 7);
  camera.quaternion.set(0, 1, 0, 0);
  buttons.home();
  assert.deepEqual(
    { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() },
    home,
  );
  assert.equal(controls.followCalls, 2, 'initial pose and repeated Home both reach the controller');
});
