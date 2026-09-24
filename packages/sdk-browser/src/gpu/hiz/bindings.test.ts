import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_SHADER, hizBindEntries } from './shader.ts';
import {
  entryBufferBindings,
  wgslBufferBindings,
  wgslTextureBindings,
} from '../core/wgslBindings.fixture.ts';

test('the Hi-Z layout entries are the bindings its shader declares, buffers and texture', () => {
  const entries = hizBindEntries(256);
  const buffers = entries.filter((entry) => entry.buffer);
  assert.deepEqual(entryBufferBindings(buffers), wgslBufferBindings(HIZ_SHADER));
  const textures = entries.filter((entry) => entry.texture).map((entry) => entry.binding);
  assert.deepEqual(textures, wgslTextureBindings(HIZ_SHADER));
  assert.equal(buffers.length + textures.length, entries.length, 'every entry is checked');
});
