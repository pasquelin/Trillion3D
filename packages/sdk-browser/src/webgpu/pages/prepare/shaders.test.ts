import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADER } from './shaders.ts';

// The fallback transparent pass blends each mode by the surface's alpha, as the main pass does:
// a colour written with alpha 1 would draw a normal surface at opacity 0.5 opaque.
test('the fallback fragment returns the surface alpha, not an opaque 1', () => {
  const fragment = SHADER.slice(SHADER.indexOf('@fragment fn fs'));
  const shaded = fragment.slice(fragment.lastIndexOf(' return '));
  assert.match(shaded, /return vec4f\(linearToSrgb\(aces\(in\.color\.xyz\)\),in\.color\.w\);/);
});
