import test from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_EXPAND_SHADER } from './expandWgsl.ts';
import { blendExpandBindEntries, EXPAND_BINDING } from './expandBindings.ts';
import { UNI_WORDS } from './runs.ts';
import { entryBufferBindings, wgslBufferBindings } from '../../gpu/core/wgslBindings.fixture.ts';

test('the blend-expand layout entries are the bindings its shader declares', () => {
  const declared = wgslBufferBindings(BLEND_EXPAND_SHADER);
  assert.equal(declared.length, 9);
  assert.deepEqual(entryBufferBindings(blendExpandBindEntries()), declared);
});

test('the blend-expand uniform is bound at a dynamic offset over its whole block', () => {
  const [uniform] = blendExpandBindEntries();
  assert.deepEqual(uniform.buffer, {
    type: 'uniform',
    hasDynamicOffset: true,
    minBindingSize: UNI_WORDS * 4,
  });
});

test('each blend-expand buffer name owns its own binding, from 0 without a gap', () => {
  const bindings = Object.values(EXPAND_BINDING).sort((a, b) => a - b);
  assert.deepEqual(bindings, [...bindings.keys()]);
});
