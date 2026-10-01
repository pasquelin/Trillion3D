import test from 'node:test';
import assert from 'node:assert/strict';
import { xrWorldOptions } from './options.ts';

test('XR auto renderer falls back before acquiring a context, leaving ordinary worlds and explicit choices unchanged', () => {
  const plain = {},
    xr = { xr: true };
  assert.equal(xrWorldOptions(plain, false), plain);
  assert.equal(xrWorldOptions(xr, false).renderer, 'webgl2');
  assert.equal(xrWorldOptions(xr, true), xr);
  const explicit = { xr: true, renderer: 'webgpu' as const };
  assert.equal(xrWorldOptions(explicit, false), explicit);
});
