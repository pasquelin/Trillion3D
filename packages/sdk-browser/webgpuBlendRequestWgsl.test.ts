import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_REQUEST_WGSL } from './webgpuBlendRequestWgsl.ts';

import { TILE_REQUEST_WGSL } from './webgpuTileRequestWgsl.ts';
import { SHADE_REQUEST_WGSL } from './visibilityShaderRequest.ts';

// La demande d'un pixel — transparent ou opaque — suit une seule règle, celle de `TILE_REQUEST_WGSL` :
// la phase choisit les pixels qui parlent, la POSITION choisit la carte et le niveau, si bien que
// deux images complètes d'une même pose nomment le même ensemble de tuiles, celui sur lequel la
// convergence de la barrière s'arrête. Aucun des deux hôtes ne réécrit la règle.
test('les deux passes demandent leurs tuiles par la même règle, phase puis position', () => {
  assert.match(TILE_REQUEST_WGSL, /fn requestPick\(pos:vec2f,choices:u32\)/);
  assert.match(TILE_REQUEST_WGSL, /let px=u32\(pos\.x\)\+u32\(pos\.y\);/);
  assert.match(TILE_REQUEST_WGSL, /RequestPick\(px%choices,\(\(px\/choices\)&1u\)==1u\)/);
  for (const [nom, hote] of Object.entries({ BLEND_REQUEST_WGSL, SHADE_REQUEST_WGSL })) {
    assert.match(hote, /feedbackPhase\([a-z.]+,uni\.feedback\)/, `${nom} : la phase d'abord`);
    assert.match(hote, /requestPick\(/, `${nom} : le choix par la position`);
    assert.match(hote, /mapRequest\(p\.sel,/, `${nom} : la carte par la règle commune`);
    assert.doesNotMatch(hote, /%6u|%10u/, `${nom} ne réécrit pas le choix`);
  }
});
