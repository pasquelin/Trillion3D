import test from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_EXPAND_SHADER, blendExpandBindEntries } from './expandWgsl.ts';
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
