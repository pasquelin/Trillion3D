import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_REQUEST_WGSL } from './requestWgsl.ts';

import { TILE_REQUEST_WGSL } from '../tile/requestWgsl.ts';
import { SHADE_REQUEST_WGSL } from '../../visibility/shader/shaderRequest.ts';

// A pixel's request — transparent or opaque — follows one rule, that of `TILE_REQUEST_WGSL`:
// the phase picks which pixels speak, POSITION picks the map and the level, so two complete
// frames of the same pose name the same set of tiles, the set the barrier's convergence stops
// on. Neither host rewrites the rule.
test('both passes request their tiles by the same rule, phase then position', () => {
  assert.match(TILE_REQUEST_WGSL, /fn requestPick\(pos:vec2f,choices:u32\)/);
  assert.match(TILE_REQUEST_WGSL, /let px=u32\(pos\.x\)\+u32\(pos\.y\);/);
  assert.match(TILE_REQUEST_WGSL, /RequestPick\(px%choices,\(\(px\/choices\)&1u\)==1u\)/);
  for (const [nom, hote] of Object.entries({ BLEND_REQUEST_WGSL, SHADE_REQUEST_WGSL })) {
    assert.match(hote, /feedbackPhase\([a-z.]+,uni\.feedback\)/, `${nom}: phase first`);
    assert.match(hote, /requestPick\(/, `${nom}: choice by position`);
    assert.match(hote, /mapRequest\(p\.sel,/, `${nom}: map by the shared rule`);
    assert.doesNotMatch(hote, /%6u|%10u/, `${nom} does not rewrite the choice`);
  }
});
