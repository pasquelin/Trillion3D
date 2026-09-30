import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { EffectChain } from '../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../sdk-core/src/world/effect/index.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createWorldPhysics } from '../physics/worldPhysics.ts';
import { worldDiagnostic } from '../world/core/worldHandles.ts';
import { drawnOnArrival, frameWaits } from '../world/session/familyUse.ts';
import { families, familyRefusals } from './families.ts';
import { onDemand } from './onDemand.ts';

const turn = () => new Promise((wake) => setImmediate(wake));

/** `name`'s entry of the table in place of the real one for this test, loaded by `load`, its
 *  refusals told as the table tells them. */
function standIn<N extends keyof typeof families>(t: TestContext, name: N, load: () => unknown) {
  const real = families[name];
  const told = (error: EngineError) => familyRefusals.forEach((listener) => listener(error));
  families[name] = onDemand(name, load as never, told) as (typeof families)[N];
  t.after(() => void (families[name] = real));
}

/** A session's frames on a chain with one pass, drawn once its family has arrived. */
function frames() {
  const effects = new EffectChain();
  effects.add(effect.bloom());
  let drawn = 0;
  const invalidate = drawnOnArrival(
    () => frameWaits({ effects }, 'beauty'),
    () => drawn++,
    () => false,
  );
  return { invalidate, drawn: () => drawn };
}

test('a family whose import fails once arrives, and the frame that needs it draws it (#1404)', async (t) => {
  let imports = 0;
  standIn(t, 'effects', async () => {
    if (++imports === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return {};
  });
  const diagnostic = worldDiagnostic(() => null);
  t.after(() => diagnostic.close());
  const { invalidate, drawn } = frames();
  invalidate();
  assert.equal(drawn(), 0, 'the frame waits for the chain');
  await turn();
  assert.deepEqual([imports, drawn(), diagnostic.handle.error], [2, 1, null]);
});

test('a family that never loads is named on the world, and no frame draws without it', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); // the next round's wait, never over
  standIn(t, 'effects', () => Promise.reject(new Error('CHUNK_MISSING')));
  const diagnostic = worldDiagnostic(() => null);
  t.after(() => diagnostic.close());
  const { invalidate, drawn } = frames();
  invalidate();
  await turn();
  const error = diagnostic.handle.error;
  assert.equal(error?.code, 'FAMILY_LOAD_FAILED');
  assert.equal(error?.details.family, 'effects');
  assert.match(String(error?.message), /^T3D-E090 FAMILY_LOAD_FAILED: the effects family/);
  invalidate();
  assert.equal(drawn(), 0, 'the chain is never dropped: its frames wait');
  diagnostic.close();
  assert.equal(familyRefusals.size, 0, 'a closed world hears no more');
});

test('physics arrives through the same loader as the other families', async (t) => {
  t.mock.method(console, 'error', () => {});
  let imports = 0;
  standIn(t, 'physics', () => (imports++, Promise.reject(new Error('CHUNK_MISSING'))));
  const runtime = { invalidate() {}, explorer: null };
  const physics = createWorldPhysics(runtime, new Group(), () => new Camera('perspective'));
  physics.handle.enabled = true;
  await turn();
  assert.equal(imports, 2, "the loader's two attempts");
  assert.equal(physics.handle.error?.code, 'FAMILY_LOAD_FAILED');
  assert.equal(physics.handle.error?.details.family, 'physics');
  assert.equal(physics.handle.enabled, false, 'a simulation that could not start is off');
});
