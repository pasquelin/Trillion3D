// A split cut's kernel binds every part its layout declares, reads across them through the same
// accessors, and a whole cut keeps the shipped text (#974).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dagBindEntries } from './bindings.ts';
import { DAG_SELECTION_SHADER } from './shader.ts';
import { dagPartCounts, dagSelectionShader } from './splitWgsl.ts';
import { dagSplit } from '../split.ts';
import { entryBufferBindings, wgslBufferBindings } from '../../core/wgslBindings.fixture.ts';
import { unresolvedNames } from '../../core/wgslNames.fixture.ts';

const shape = { pageCount: 1000, nodeCount: 10, worldCount: 10 },
  sizes = { clusters: 48 * 200, nodes: 96 * 10, cold: 4 * 1500 };

test('a whole cut keeps the shipped kernel', () => {
  const whole = dagSplit({ maxStorageBufferBindingSize: 1 << 27 }, shape, sizes);
  assert.equal(dagSelectionShader(whole), DAG_SELECTION_SHADER);
  assert.equal(dagSelectionShader(), DAG_SELECTION_SHADER);
});

test('a split kernel declares the bindings its layout makes, and every name it reads', () => {
  const split = dagSplit({ maxStorageBufferBindingSize: 4096 }, shape, sizes);
  const counts = dagPartCounts(split);
  assert.deepEqual(counts, { clusters: 3, nodes: 1, cold: 2, flags: 5 });
  const text = dagSelectionShader(split);
  assert.equal(wgslBufferBindings(text).length, 10 + 2 + 1 + 4);
  assert.deepEqual(entryBufferBindings(dagBindEntries(counts)), wgslBufferBindings(text));
  assert.deepEqual(unresolvedNames(text), []);
  for (const read of ['clusters2[i-170u]', 'cold1[i-1024u]', 'flags4[i-flagSection(7u)]=v'])
    assert.ok(text.includes(read), read);
});
