// Common-formulas lot: each WGSL fragment factored out of `pageWgsl.ts` must stay the
// unique write of its identifier, and each shader that assembles it must carry it only once —
// two copies in the same text would be two chances of seeing it drift, as before this lot.
import { importWrapMode } from '../../host/surfaceImport.ts';
import test from 'node:test';
import { TAA_SHADER } from '../../taa/shaderWgsl.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PAGE_INFO_STRUCT_WGSL,
  EDGE_WGSL,
  PAGE_VERTEX_WGSL,
  PAGE_UV_WGSL,
  MASK_KEEP_WGSL,
  BARY_WEIGHTS_WGSL,
} from './pageWgsl.ts';
import { WRAP_COORD_WGSL, wrapLinear } from '../wrapModes.ts';
import { lineaireThree } from '../../../../../tests/browser/probes/addressingCases.ts';
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL, maskAlphaWgsl } from '../../webgpu/tile/wgsl.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';

const SMALL_SHADER = rasterSource(4, 16);

/** How many times `fragment` appears, character for character, in `text`. */
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

function eachOnce(fragment: string, shaders: Record<string, string>) {
  for (const [name, text] of Object.entries(shaders))
    assert.equal(occurrences(text, fragment), 1, `${name} should carry the fragment once`);
}

test('PAGE_INFO_STRUCT_WGSL declares struct PageInfo only once in every shader that reads it', () => {
  assert.match(PAGE_INFO_STRUCT_WGSL, /struct PageInfo\{/);
  eachOnce(PAGE_INFO_STRUCT_WGSL, {
    SMALL_SHADER,
    SHADE_SHADER,
    VIS_SHADER,
    SHADOW_DEPTH_SHADER,
    TAA_SHADER,
  });
});

test('EDGE_WGSL declares fn edge only once in the small-triangle raster and in shading', () => {
  assert.match(EDGE_WGSL, /fn edge\(/);
  eachOnce(EDGE_WGSL, { SMALL_SHADER, SHADE_SHADER });
});

test('PAGE_VERTEX_WGSL declares fn vertPos only once in the raster, shading and shadows', () => {
  assert.match(PAGE_VERTEX_WGSL, /fn vertPos\(/);
  eachOnce(PAGE_VERTEX_WGSL, { SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('PAGE_UV_WGSL declares fn vertUv only once in the raster, shading and shadows', () => {
  assert.match(PAGE_UV_WGSL, /fn vertUv\(/);
  eachOnce(PAGE_UV_WGSL, { SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('WRAP_COORD_WGSL declares fn wrapCoord only once, directly as via MASK_KEEP_WGSL', () => {
  assert.match(WRAP_COORD_WGSL, /fn wrapCoord\(/);
  eachOnce(WRAP_COORD_WGSL, { SMALL_SHADER, SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('MASK_KEEP_WGSL declares fn maskKeep only once in the raster and both shadows', () => {
  assert.match(MASK_KEEP_WGSL, /fn maskKeep\(/);
  eachOnce(MASK_KEEP_WGSL, { SMALL_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('BARY_WEIGHTS_WGSL declares fn baryWeights only once in shading, never in the raster', () => {
  assert.match(BARY_WEIGHTS_WGSL, /fn baryWeights\(/);
  eachOnce(BARY_WEIGHTS_WGSL, { SHADE_SHADER });
  // The raster decides coverage on its three edges, not on derived weights.
  assert.doesNotMatch(SMALL_SHADER, /baryWeights/);
});

// Defect 7: under linear filtering with `Repeat`, a period's seam must mix the last texel and
// the first. The reference rule is `lineaireThree` (tests/browser/probes/addressingCases.ts), written
// independently of `wrapLinear` and already checked against the real WebGL2 and WebGPU samplers
// by `tests/browser/probes/addressing-gpu.ts`: the low rank comes from the coordinate shifted by a
// half-texel, and each of the two ranks undergoes the mode for itself (OpenGL ES 3.0 § 3.8.10,
// the same rule as WebGPU). Copying it here used to make a third write of the same rule.
const regle = lineaireThree as (
  t: number,
  taille: number,
  wrap: THREE.Wrapping,
) => [number, number, number];
/** The value the two mixed texels yield: tap order is not imposed, colour is. */
const valeur = ([i0, i1, poids]: [number, number, number]) => i0 * (1 - poids) + i1 * poids;

test('wrapLinear mixes the two texels of the rule, a period seam included', () => {
  const coordonnees = [];
  for (const entier of [-1001, -3, -1, 0, 1, 2, 1000])
    for (const reste of [0, 0.01, 0.2, 0.499, 0.5, 0.501, 0.8, 0.99])
      coordonnees.push(Math.fround(entier + reste));
  let couture = 0;
  for (const taille of [1, 2, 3, 4, 5, 8])
    for (const wrap of [
      THREE.ClampToEdgeWrapping,
      THREE.RepeatWrapping,
      THREE.MirroredRepeatWrapping,
    ])
      for (const t of coordonnees) {
        const attendu = regle(t, taille, wrap);
        if (attendu[1] !== attendu[0] + 1 && wrap === THREE.RepeatWrapping) couture++;
        assert.ok(
          Math.abs(valeur(wrapLinear(t, taille, importWrapMode(wrap))) - valeur(attendu)) <= 1e-9,
          `${taille} texels, t=${t}: rule ${attendu}, read ${wrapLinear(t, taille, importWrapMode(wrap))}`,
        );
      }
  assert.ok(couture > 100, `the series must exercise the seam, only ${couture} cases`);
});

// Folding a coordinate cannot wrap a period: both taps and their weight are therefore carried
// through to the atlas reads, which mix four reads on the seam and a single one elsewhere. A
// read that took the folded coordinate alone would reopen the defect.
test('atlas reads receive their map nibble and mix four taps', () => {
  assert.match(
    WRAP_COORD_WGSL,
    /struct WrapTaps\{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,\}/,
  );
  for (const [nom, bloc] of Object.entries({
    COLOR_SAMPLE_WGSL,
    MASK_ALPHA_WGSL: maskAlphaWgsl(true),
    DATA_SAMPLE_WGSL,
  })) {
    assert.match(bloc, /,uv:vec2f,wrap:u32/, `${nom} must receive its map nibble`);
    // #360, #361: the texture's transform and filter word reach every read, blended and shadow alike.
    assert.match(
      bloc,
      /let r=(color|data)Read\(slot,s,uv,ddx,ddy\);/,
      `${nom} must read its sampling`,
    );
    assert.match(
      bloc,
      /if\(!t\.couture\|\|r\.nearest\)\{return /,
      `${nom} must keep the unique read`,
    );
    assert.match(
      bloc,
      /mix\(mix\(s00,s10,t\.poids\.x\),mix\(s01,s11,t\.poids\.x\),t\.poids\.y\)/,
      nom,
    );
  }
  for (const [nom, texte] of Object.entries({
    SMALL_SHADER,
    SHADE_SHADER,
    VIS_SHADER,
    SHADOW_DEPTH_SHADER,
  }))
    // An atlas read (`let t=wrapUv(`) or the feedback that names it (`return wrapUv(`): the
    // coordinate the pixel asks for is the one it reads.
    assert.equal(
      occurrences(texte, 'wrapUv('),
      occurrences(texte, 'fn wrapUv(') +
        occurrences(texte, 'let t=wrapUv(') +
        occurrences(texte, 'return wrapUv('),
      `${nom} only folds a coordinate in an atlas read, never on its own account`,
    );
});
