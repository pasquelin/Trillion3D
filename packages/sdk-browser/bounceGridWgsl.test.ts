// Lot formules communes : la constante de Lambert 1/π ne s'écrit qu'une fois, et chaque nuanceur de
// rebond qui l'importe la porte une seule fois dans son texte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_PI_WGSL } from './bounceGridWgsl.ts';
import { BOUNCE_APPLY_WGSL } from './bounceApplyWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from './bounceSurfaceWgsl.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('INVERSE_PI_WGSL déclare la constante 1/π attendue par les deux passes de rebond', () => {
  assert.match(INVERSE_PI_WGSL, /const INVERSE_PI:f32=0\.31830989;/);
});

test('INVERSE_PI_WGSL apparaît une seule fois dans l’application et dans le cache de surfaces', () => {
  assert.equal(occurrences(BOUNCE_APPLY_WGSL, INVERSE_PI_WGSL), 1);
  assert.equal(occurrences(BOUNCE_SURFACE_SHADER, INVERSE_PI_WGSL), 1);
});
