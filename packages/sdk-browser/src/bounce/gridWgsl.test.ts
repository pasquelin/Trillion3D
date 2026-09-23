// Shared-formulas batch: the Lambert 1/π constant is written once, and every bounce shader
// that imports it carries it only once in its text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_PI_WGSL } from './gridWgsl.ts';
import { BOUNCE_APPLY_WGSL } from './applyWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from './surfaceWgsl.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('INVERSE_PI_WGSL declares the 1/π constant expected by both bounce passes', () => {
  assert.match(INVERSE_PI_WGSL, /const INVERSE_PI:f32=0\.31830989;/);
});

test('INVERSE_PI_WGSL appears once in the application and once in the surface cache', () => {
  assert.equal(occurrences(BOUNCE_APPLY_WGSL, INVERSE_PI_WGSL), 1);
  assert.equal(occurrences(BOUNCE_SURFACE_SHADER, INVERSE_PI_WGSL), 1);
});
