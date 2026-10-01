import test from 'node:test';
import assert from 'node:assert/strict';
import { debugMode, setDebugMode } from './debugMode.ts';
import { worldDiagnostic } from '../world/core/worldHandles.ts';

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
