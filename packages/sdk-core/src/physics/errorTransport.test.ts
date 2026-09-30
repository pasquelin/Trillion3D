import test from 'node:test';
import assert from 'node:assert/strict';
import { startJolt } from '../../../sdk-browser/src/physics/joltModule.ts';
import { physicsBudgetOf } from './options.ts';
import { EngineError } from '../contracts/cache.ts';

test('native error numbers reach callers as named engine failures', () => {
  let error = 0;
  const exports = {
    _initialize() {},
    jolt_init: () => 0,
    jolt_buffer: () => 4,
    jolt_step: () => -1,
    jolt_error: () => error,
  } as unknown as WebAssembly.Exports;
  const module = startJolt(
    { exports, memory: new WebAssembly.Memory({ initial: 1 }) },
    physicsBudgetOf(),
  );
  for (const name of ['NONE', 'BODY_LIMIT', 'UNKNOWN_BODY', 'BAD_SHAPE', 'BAD_COMMAND']) {
    assert.throws(
      () => module.step(null, 0),
      (failure: unknown) => {
        assert.ok(failure instanceof EngineError);
        assert.equal(failure.code, 'PHYSICS_FAILED');
        assert.equal(failure.message, `Physics: ${name} in a command.`);
        return true;
      },
    );
    error++;
  }
});
