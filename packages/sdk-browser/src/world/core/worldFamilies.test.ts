import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { families } from '../../host/families.ts';
import { frameWaits } from '../session/familyUse.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

test('a host-led frame waits for a family on its way: nothing steps nor draws, then it does (#1353)', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const { session } = sessionStandIn();
  const effects = new EffectChain();
  let drawn = 0,
    stepped = 0;
  Object.assign(session, {
    render: () => (drawn++, {}),
    familiesPending: () => frameWaits({ effects }, 'beauty'),
  });
  const failures: unknown[] = [];
  const runtime = runtimeOf(
    scene,
    ready,
    (error) => failures.push(error),
    (async () => session) as unknown as Open,
  );
  scene.add(object.mesh(geometry.box(1, 1, 1)));
  await runtime.settled();
  effects.add(effect.bloom()); // the page's call, on the open session
  assert.equal(
    runtime.render(() => stepped++),
    null,
    'the frame waits for the chain',
  );
  assert.deepEqual([stepped, drawn], [0, 0]);
  await runtime.settled(); // which waits for a family on its way too
  assert.equal(families.effects.arrived, true);
  assert.ok(runtime.render(() => stepped++));
  assert.deepEqual([stepped, drawn, failures], [1, 1, []], 'drawn once arrived, stepped first');
  runtime.dispose();
});
