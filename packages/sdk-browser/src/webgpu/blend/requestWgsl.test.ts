import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_REQUEST_WGSL } from './requestWgsl.ts';

import { TILE_REQUEST_WGSL } from '../tile/requestWgsl.ts';
import { SHADE_REQUEST_WGSL } from '../../visibility/shader/request.ts';

// A pixel's request — transparent or opaque — follows one rule, that of `TILE_REQUEST_WGSL`:
// the phase picks which pixels speak, POSITION picks the map and the level, so two complete
// frames of the same pose name the same set of tiles, the set the barrier's convergence stops
// on. Neither host rewrites the rule.
test('both passes request their tiles by the same rule, phase then position', () => {
  assert.match(TILE_REQUEST_WGSL, /fn requestPick\(pos:vec2f,choices:u32\)/);
  assert.match(TILE_REQUEST_WGSL, /let px=u32\(pos\.x\)\+u32\(pos\.y\);/);
  assert.match(
    TILE_REQUEST_WGSL,
    /RequestPick\(px%choices,\(\(px\/choices\)&1u\)==1u,\(px\/choices\/2u\)%3u,\(\(px\/choices\/6u\)&1u\)==1u\)/,
  );
  for (const [nom, hote] of Object.entries({ BLEND_REQUEST_WGSL, SHADE_REQUEST_WGSL })) {
    assert.match(hote, /feedbackPhase\([a-z.]+,uni\.feedback\)/, `${nom}: phase first`);
    assert.match(hote, /requestPick\(/, `${nom}: choice by position`);
    assert.match(hote, /mapRequest\(p,/, `${nom}: map by the shared rule`);
    assert.doesNotMatch(hote, /%6u|%10u/, `${nom} does not rewrite the choice`);
  }
});

// #361: an anisotropic read spreads its taps along the footprint, into tiles its centre does not
// touch; the pixels of the footprint ask for the first tap, the middle one and the last by
// position, placed by the read's own `tapOffset`. One tap puts all three on the centre.
test('an anisotropic footprint asks for the tiles of its end taps, placed as the read places them', () => {
  assert.match(
    TILE_REQUEST_WGSL,
    /at=r\.uv\+r\.axis\*tapOffset\(along\*\(r\.taps-1u\)\/2u,r\.taps\);/,
  );
  assert.match(TILE_REQUEST_WGSL, /slotWrapped\(s,at\)/);
  const tap = (along: number, taps: number) => Math.floor((along * (taps - 1)) / 2);
  for (const taps of [1, 2, 7, 8]) {
    assert.equal(tap(0, taps), 0, `${taps} taps: the first`);
    assert.equal(tap(2, taps), taps - 1, `${taps} taps: the last`);
  }
});

// #360, #361: what a pixel asks is what it reads. The level a request asks follows the read of the
// pass that posts it — `aniso` — never a constant: the blend and the shading read anisotropically,
// so their maps ask the anisotropic level; a data map is never read by a cutout.
test('a request asks the level of the read that posts it', () => {
  assert.match(TILE_REQUEST_WGSL, /next:bool,along:u32,aniso:bool\)->u32\{/);
  assert.match(TILE_REQUEST_WGSL, /let r=(color|data)Footprint\(slot,s,uv,ddx,ddy,aniso\);/);
  assert.doesNotMatch(TILE_REQUEST_WGSL, /Footprint\(slot,s,uv,ddx,ddy,true\)/);
  assert.match(TILE_REQUEST_WGSL, /dataRequestIndex\([^;]*,p\.next,p\.along,true\);/);
  assert.match(BLEND_REQUEST_WGSL, /mapRequest\(p,[^;]*,false\);/, 'no cutout in the blend');
});

// #360, #361: the alpha cutouts (`maskAlpha`) read the isotropic level. The shadow cascades ask for
// it alone; on screen a masked material's base map is read by the cutout AND by the shading, so its
// pixels share out the two levels (`iso`), and an unmasked one asks only for the shading's.
test('the cutouts ask the isotropic level they read, the shading the anisotropic one', () => {
  assert.match(SHADE_REQUEST_WGSL, /colorRequestIndex\([^;]*g\.xy,g\.zw,p\.next,1u,false\);/);
  assert.match(SHADE_REQUEST_WGSL, /mapRequest\(p,[^;]*,HAS_MASK\);/);
  assert.match(TILE_REQUEST_WGSL, /let aniso=!\(cutout&&map==0u&&p\.iso\);/);
  assert.match(TILE_REQUEST_WGSL, /colorRequestIndex\([^;]*,p\.next,p\.along,aniso\);/);
});
