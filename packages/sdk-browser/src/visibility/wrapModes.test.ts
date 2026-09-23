// Defect 4: one bit per axis, never both modes of the same axis, no bit in clamp.
// Defect 8: each material map addresses its texture in its own wrap. The page record therefore
// carries one nibble per map, and each shader read receives the nibble of the map it samples —
// not the material flags, which carried only one for all of them.
// Proof on a real GPU is the `tests/browser/probes/addressing-maps-gpu.ts` bench.
import type { Texture } from '../../../sdk-core/src/index.ts';
import { importWrapMode } from '../host/surfaceImport.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WRAP_MAP,
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
  wrapModes,
  wrapNibble,
  wrapOf,
} from './wrapModes.ts';
import { visMaterial } from './types.ts';
import { ROW_WRAP_MODES_WORD } from '../webgpu/row/pageRow.ts';
import { SHADE_SHADER } from './shader/shadeWgsl.ts';
import { BLEND_SHADER } from '../webgpu/blend/shader.ts';
import { MASK_KEEP_WGSL } from './shader/pageWgsl.ts';
import {
  CARTES,
  ligneDePageMelangee,
  materielMelange,
} from '../../../../tests/browser/probes/addressingMaps.ts';

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

test('wrapModes stores each map nibble at its rank, six maps in one word', () => {
  const mot = wrapModes(visMaterial(materielMelange()));
  for (const entree of CARTES)
    assert.equal(wrapOf(mot, entree.carte), attendu(entree), `map ${entree.nom}`);
  assert.equal(mot >>> 24, 0, 'six nibbles fit in the low twenty-four bits');
});

test('the page record carries each map wrap, not that of the base map alone', () => {
  const { ints } = ligneDePageMelangee();
  const lus = CARTES.map((entree) => wrapOf(ints[ROW_WRAP_MODES_WORD], entree.carte));
  for (const [i, entree] of CARTES.entries())
    assert.equal(lus[i], attendu(entree), `map ${entree.nom} in the page record`);
  assert.equal(new Set(lus).size, CARTES.length, 'six maps, six distinct nibbles');
  // The flags word no longer carries wrap: its bits 32, 64, 32768 and 65536 are free.
  assert.equal(ints[23] & (32 | 64 | 32768 | 65536), 0);
});

/**
 * Start of each atlas read of the two production shaders, including its wrap argument: that
 * link — this map read with this nibble — is what defect 8 broke. Giving any one of these reads
 * another map's nibble fails the test.
 */
const APPELS = {
  SHADE_SHADER: [
    `colorSample(page.mapIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u)`,
    `dataSample(page.roughnessIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.rough}u)`,
    `dataSample(page.metalnessIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.metal}u)`,
    `dataSample(page.normalIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.normal}u)`,
    `dataSample(page.aoIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.ao}u)`,
    `colorSample(page.emissiveIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.emissive}u)`,
  ],
  // Blend now reads the item record as flat variables: map ranks arrive through `in.ids` and
  // `in.maps`, and the wrap word through `wrap`. Same link checked: this map read with this nibble.
  BLEND_SHADER: [
    `colorSample(in.ids.x,in.uv,wrapOf(wrap,${WRAP_MAP.base}u)`,
    `dataSample(in.maps.x,in.uv,wrapOf(wrap,${WRAP_MAP.rough}u)`,
    `dataSample(in.maps.y,in.uv,wrapOf(wrap,${WRAP_MAP.metal}u)`,
    `dataSample(in.maps.z,in.uv,wrapOf(wrap,${WRAP_MAP.normal}u)`,
    `dataSample(in.maps.w,in.uv,wrapOf(wrap,${WRAP_MAP.ao}u)`,
    `colorSample(in.ids.z,in.uv,wrapOf(wrap,${WRAP_MAP.emissive}u)`,
  ],
};

for (const [nom, texte] of Object.entries({ SHADE_SHADER, BLEND_SHADER }))
  test(`${nom} gives each read the nibble of its own map`, () => {
    for (const appel of APPELS[nom as keyof typeof APPELS])
      assert.ok(texte.includes(appel), `read missing or wrongly wrapped: ${appel}`);
    assert.doesNotMatch(
      texte,
      /(?:colorSample|colorAlpha|dataSample)\([^)]*\.flags/,
      'no read must take the material flags as wrap',
    );
  });

// `wrapModes` and the two shaders' reads now derive from `WRAP_MAP`. This test holds the
// derivation from the other end: every rank of the word is read by the sample and by the frame
// feedback that names it, with the same nibble — twice in shading, one read and one feedback
// rank in blend, which picks its map per pixel. A seventh map added to `WRAP_MAP` but never
// read would wrap in clamp without anything saying so — that silence is what fails here.
test('every WRAP_MAP rank is read by the sample and by the frame feedback of both shaders', () => {
  const fois = (texte: string, motif: string) => texte.split(motif).length - 1;
  for (const rang of Object.values(WRAP_MAP)) {
    // In shading, each map is read by its nibble; the base is read a second time by the tile
    // request for the sun shadow (`shader/request.ts`), and data maps compare their
    // nibble to already-read maps to reuse them (`lectureDonnee`): roughness and occlusion two
    // comparisons, metal two. Frame feedback addresses by the shared rule (`mapRequest`), with
    // no nibble written per map.
    const attendu = { 0: 2, 1: 3, 2: 3, 3: 1, 4: 3, 5: 1 }[rang] ?? 1;
    assert.equal(
      fois(SHADE_SHADER, `wrapOf(page.wrapModes,${rang}u)`),
      attendu,
      `rank ${rang}, shading`,
    );
    assert.equal(fois(BLEND_SHADER, `wrapOf(wrap,${rang}u)`), 1, `rank ${rang}, transparent lot`);
    assert.equal(
      fois(BLEND_SHADER, `map=${rang}u;`),
      rang === WRAP_MAP.base ? 2 : 1,
      `rank ${rang}, feedback`,
    );
  }
});

test('alpha cut-out addresses the base map by its nibble, never by the flags', () => {
  assert.ok(
    MASK_KEEP_WGSL.includes(
      `maskAlpha(page.mapIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u),ddx,ddy)`,
    ),
  );
});
