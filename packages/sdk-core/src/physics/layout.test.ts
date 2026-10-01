import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_ERROR } from './layout.ts';
import { joltEnum } from './wire.fixture.ts';

test('each error number the module answers is named as the binding names it', () => {
  assert.deepEqual(MODULE_ERROR, joltEnum('binding.h', 'Error'));
});
