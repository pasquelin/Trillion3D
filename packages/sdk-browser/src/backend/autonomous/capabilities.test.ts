import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomousCapabilities } from './capabilities.ts';

// #337: the WebGL2 page path draws blended and transmissive surfaces as whole scene copies; its
// declaration names them among what it renders, never among what it does not.
test('the WebGL2 page path declares the blend and transmission it draws', () => {
  const { materials, unsupported } = autonomousCapabilities(false);
  assert.match(materials, /blended/);
  assert.match(materials, /transmission/);
  assert.ok(!unsupported.some((entry) => /BLEND|transmission/.test(entry)));
});

// #363: WebGL2 has no temporal antialiasing; `world.temporalAntialiasing` reads false there.
test('the WebGL2 page path declares temporal antialiasing unsupported', () => {
  assert.ok(autonomousCapabilities(false).unsupported.includes('temporal antialiasing'));
});
