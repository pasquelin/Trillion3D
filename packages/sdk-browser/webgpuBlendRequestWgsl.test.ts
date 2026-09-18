import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_REQUEST_WGSL } from './webgpuBlendRequestWgsl.ts';

// La demande d'un pixel transparent ne dépend que de sa position : deux images complètes d'une
// même pose nomment le même ensemble de tuiles, celui sur lequel la convergence de la barrière
// s'arrête. La phase ne choisit que les pixels que la réduction lit.
test('la demande des transparents se choisit par la position du pixel, jamais par la phase', () => {
  assert.doesNotMatch(BLEND_REQUEST_WGSL, /uni\.feedback/);
  assert.match(BLEND_REQUEST_WGSL, /let px=u32\(in\.position\.x\)\+u32\(in\.position\.y\);/);
  assert.match(BLEND_REQUEST_WGSL, /let sel=px%6u;/);
  assert.match(BLEND_REQUEST_WGSL, /let next=\(\(px\/6u\)&1u\)==1u;/);
});
