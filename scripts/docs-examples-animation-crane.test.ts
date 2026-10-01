import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { animation } from '../packages/sdk/browser.ts';
import { fakeWorld } from './docs/examples/world.ts';
import { runControlledExample } from './docs/examples/controlled.ts';

type Values = { speed: number; paused: boolean };

test('the crane clip moves every mechanism and its controls pause, resume and replay it', async () => {
  const html = await readFile(
    new URL('../site/examples/a-crane-that-swings.html', import.meta.url),
    'utf8',
  );
  const { world } = fakeWorld();
  const { scene } = world;
  let mixer: ReturnType<typeof animation.createMixer> | undefined;
  let clip: ReturnType<typeof animation.clip> | undefined;
  const { change, specs } = await runControlledExample<Values>(html, world, {
    engine: {
      animation: {
        ...animation,
        clip(...args: Parameters<typeof animation.clip>) {
          return (clip = animation.clip(...args));
        },
        createMixer(root: Parameters<typeof animation.createMixer>[0]) {
          return (mixer = animation.createMixer(root));
        },
      },
    },
  });
  const replay = specs.replay;
  assert.ok(typeof replay === 'function');

  assert.ok(mixer && clip);
  const action = mixer.clipAction(clip);
  const crane = scene.getObjectByName('crane'),
    jib = scene.getObjectByName('jib'),
    trolley = scene.getObjectByName('trolley'),
    cable = scene.getObjectByName('cable'),
    hoist = scene.getObjectByName('hoist'),
    load = scene.getObjectByName('load');
  assert.ok(crane && jib && trolley && cable && hoist && load);
  const pose = () => [
    jib.rotation.y,
    trolley.position.x,
    cable.scale.y,
    load.position.y,
    hoist.rotation.z,
  ];
  mixer.update(0);
  const start = pose();
  mixer.update(2);
  assert.notEqual(jib.rotation.y, start[0], 'the jib slews');
  assert.notEqual(trolley.position.x, start[1], 'the trolley travels');
  assert.notEqual(hoist.rotation.z, start[4], 'the cable and load swing together');
  mixer.update(2);
  assert.notEqual(cable.scale.y, start[2], 'the cable shortens');
  assert.notEqual(load.position.y, start[3], 'the load rises');

  change({ speed: 1.6, paused: false }, 'speed');
  assert.equal(action.timeScale, 1.6);
  change({ speed: 1.6, paused: true }, 'paused');
  assert.equal(action.timeScale, 1.6);
  assert.equal(action.playingNow, false);
  const paused = pose();
  assert.equal(mixer.update(1), false, 'a paused mixer no longer asks for frames');
  assert.deepEqual(pose(), paused);
  change({ speed: 1.6, paused: false }, 'paused');
  assert.equal(action.playingNow, true);
  mixer.update(1);
  assert.notDeepEqual(pose(), paused);
  replay();
  assert.equal(action.time, 0);
  assert.equal(action.playingNow, true);
  assert.deepEqual(pose(), start);

  change({ speed: 1.6, paused: true }, 'paused');
  replay();
  assert.equal(action.playingNow, false, 'replay respects pause');
  assert.equal(mixer.update(1), false);
  assert.deepEqual(pose(), start);
});
