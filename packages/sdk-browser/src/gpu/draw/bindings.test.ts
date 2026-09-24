import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBindEntries, drawShader } from './shader.ts';
import { entryBufferBindings, wgslBufferBindings } from '../core/wgslBindings.fixture.ts';

test('the draw compaction layout entries are the bindings its shader declares', () => {
  for (const layers of [1, 4]) {
    const declared = wgslBufferBindings(drawShader(layers));
    assert.equal(declared.length, 9);
    assert.deepEqual(entryBufferBindings(drawBindEntries()), declared, `${layers} layers`);
  }
});
