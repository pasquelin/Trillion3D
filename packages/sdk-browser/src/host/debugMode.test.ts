import test from 'node:test';
import assert from 'node:assert/strict';
import { debugMode, setDebugMode } from './debugMode.ts';
import { worldDiagnostic } from '../world/core/worldHandles.ts';
import { EngineProfiler } from '../diagnostic/telemetry.ts';
import { families } from './families.ts';

test('debug mode is off unless the page asks: a world option, its setter, or ?profile', (t) => {
  t.after(() => {
    setDebugMode(false);
    Reflect.deleteProperty(globalThis, 'location');
  });
  assert.equal(debugMode(), false, 'a page that never asks profiles nothing');
  const diagnostic = worldDiagnostic(() => null, true);
  assert.equal(diagnostic.handle.debug, true, '`WorldOptions.debug` turns it on');
  diagnostic.handle.debug = false;
  assert.equal(debugMode(), false, '`world.diagnostic.debug` turns it off');
  diagnostic.close();
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?scene=city&profile' },
    configurable: true,
  });
  assert.equal(debugMode(), true, '`?profile` in the address turns it on');
});

test('the auto-log turns debug mode on, which fetches the debug code the frame report runs', async (t) => {
  t.after(() => setDebugMode(false));
  const stop = new EngineProfiler().startAutoLog(60);
  try {
    assert.equal(debugMode(), true);
    await families.measurement.settled();
    assert.equal(families.measurement.arrived, true, 'debug mode on, the measurement chunk comes');
  } finally {
    stop();
  }
});
