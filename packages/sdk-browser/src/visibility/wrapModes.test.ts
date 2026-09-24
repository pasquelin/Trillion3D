// Defect 4: one bit per axis, never both modes of the same axis, no bit in clamp.
// Defect 8: each material map addresses its texture in its own wrap. Each texture's header
// therefore carries its own nibble, and each shader read folds by the nibble of the texture it
// samples — not the material flags, which carried only one for all of them.
// Proof on a real GPU is the `tests/browser/probes/addressing-maps-gpu.ts` bench.
import type { Texture } from '../../../sdk-core/src/index.ts';
import { importWrapMode } from '../host/surfaceImport.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
  wrapNibble,
} from './wrapModes.ts';
import { SHADE_SHADER } from './shader/shadeWgsl.ts';
import { BLEND_SHADER } from '../webgpu/blend/shader.ts';
import { MASK_KEEP_WGSL } from './shader/pageWgsl.ts';
import { CARTES, nibblesDuMelange } from '../../../../tests/browser/probes/addressingMaps.ts';

const carte = (wrapS: THREE.Wrapping, wrapT: THREE.Wrapping) =>
  ({ wrapS: importWrapMode(wrapS), wrapT: importWrapMode(wrapT) }) as Texture;
/** Expected nibble of a fixture entry, recomputed from its two declared wrap modes. */
const attendu = (c: (typeof CARTES)[number]) => wrapNibble(carte(c.wrapS, c.wrapT));

test('wrapNibble sets the repeat or mirror bit per axis, no bit in clamp', () => {
  assert.equal(wrapNibble(undefined), 0, 'no map');
  assert.equal(wrapNibble(carte(THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping)), 0);
  assert.equal(
    wrapNibble(carte(THREE.RepeatWrapping, THREE.RepeatWrapping)),
    WRAP_S_REPEAT | WRAP_T_REPEAT,
  );
  assert.equal(
    wrapNibble(carte(THREE.MirroredRepeatWrapping, THREE.MirroredRepeatWrapping)),
    WRAP_S_MIRROR | WRAP_T_MIRROR,
  );
  assert.equal(
    wrapNibble(carte(THREE.MirroredRepeatWrapping, THREE.RepeatWrapping)),
    WRAP_S_MIRROR | WRAP_T_REPEAT,
    'a different mode per axis sets a different bit per axis',
  );
  assert.equal(
    wrapNibble(carte(THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping)),
    WRAP_T_MIRROR,
    'S in clamp sets no S bit',
  );
});

test('each map carries its own nibble in its header, whatever the others', () => {
  const lus = nibblesDuMelange();
  for (const [i, entree] of CARTES.entries())
    assert.equal(lus[i], attendu(entree), `map ${entree.nom} in its header`);
  assert.equal(new Set(lus).size, CARTES.length, 'six maps, six distinct nibbles');
});

// Every atlas read folds by the nibble of the texture it reads, from that texture's header: no
// read takes an addressing argument, so none can take another map's (`../webgpu/tile/sampling.ts`).
for (const [nom, texte] of Object.entries({ SHADE_SHADER, BLEND_SHADER }))
  test(`${nom} reads each map with no addressing argument`, () => {
    assert.match(
      texte,
      /colorSample\(page\.mapIndex,uv,ddx,ddy,HAS_SAMPLING\)|colorSample\(in\.ids\.x,in\.uv,gradX,gradY,sampled\)/,
    );
    assert.doesNotMatch(texte, /wrapOf|wrapModes/, 'no per-material addressing word');
  });

test('alpha cut-out addresses the base map by its header, never by the flags', () => {
  assert.ok(MASK_KEEP_WGSL.includes('maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&64u)!=0u)'));
});
