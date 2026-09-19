// Lot formules communes : chaque fragment WGSL factorisé de `visibilityPageWgsl.ts` doit rester
// l'unique écriture de son identifiant, et chaque nuanceur qui l'assemble doit le porter une seule
// fois — deux copies dans un même texte seraient deux chances de le voir dériver, comme avant ce lot.
import test from 'node:test';
import { TAA_SHADER } from './taaShaderWgsl.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PAGE_INFO_STRUCT_WGSL,
  VIS_UNIFORMS_WGSL,
  EDGE_WGSL,
  PAGE_VERTEX_WGSL,
  PAGE_UV_WGSL,
  MASK_KEEP_WGSL,
  BARY_WEIGHTS_WGSL,
} from './visibilityPageWgsl.ts';
import { WRAP_COORD_WGSL, wrapLinear } from './visibilityWrapModes.ts';
import { lineaireThree } from '../../test/justesse/adressageCas.mjs';
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL, maskAlphaWgsl } from './webgpuTileWgsl.ts';
import { rasterSource } from './gpuRasterShader.ts';
import { SHADE_SHADER } from './visibilityShaderShade.ts';
import { VIS_SHADER } from './visibilityShaderId.ts';
import { SHADOW_DEPTH_SHADER } from './gpuShadowShader.ts';

const SMALL_SHADER = rasterSource(4, 16);

/** Nombre de fois que `fragment` apparaît, au caractère près, dans `text`. */
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

function eachOnce(fragment: string, shaders: Record<string, string>) {
  for (const [name, text] of Object.entries(shaders))
    assert.equal(occurrences(text, fragment), 1, `${name} devrait porter le fragment une fois`);
}

test('PAGE_INFO_STRUCT_WGSL déclare struct PageInfo une seule fois dans chaque nuanceur qui la lit', () => {
  assert.match(PAGE_INFO_STRUCT_WGSL, /struct PageInfo\{/);
  eachOnce(PAGE_INFO_STRUCT_WGSL, {
    SMALL_SHADER,
    SHADE_SHADER,
    VIS_SHADER,
    SHADOW_DEPTH_SHADER,
    TAA_SHADER,
  });
});

test('EDGE_WGSL déclare fn edge une seule fois dans le raster des petits triangles et l’ombrage', () => {
  assert.match(EDGE_WGSL, /fn edge\(/);
  eachOnce(EDGE_WGSL, { SMALL_SHADER, SHADE_SHADER });
});

test('PAGE_VERTEX_WGSL déclare fn vertPos une seule fois dans le raster, l’ombrage et les ombres', () => {
  assert.match(PAGE_VERTEX_WGSL, /fn vertPos\(/);
  eachOnce(PAGE_VERTEX_WGSL, { SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('PAGE_UV_WGSL déclare fn vertUv une seule fois, y compris via PAGE_MASK_WGSL', () => {
  assert.match(PAGE_UV_WGSL, /fn vertUv\(/);
  eachOnce(PAGE_UV_WGSL, { SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('WRAP_COORD_WGSL déclare fn wrapCoord une seule fois, en direct comme via MASK_KEEP_WGSL', () => {
  assert.match(WRAP_COORD_WGSL, /fn wrapCoord\(/);
  eachOnce(WRAP_COORD_WGSL, { SMALL_SHADER, SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('MASK_KEEP_WGSL déclare fn maskKeep une seule fois dans le raster et les deux ombres', () => {
  assert.match(MASK_KEEP_WGSL, /fn maskKeep\(/);
  eachOnce(MASK_KEEP_WGSL, { SMALL_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
});

test('mask keep/discard is a hash of the screen pixel and TAA sample (#25)', () => {
  assert.match(MASK_KEEP_WGSL, /fn maskHash\(pixel:vec2f,frame:f32\)/);
  assert.match(MASK_KEEP_WGSL, /coverage>maskHash\(pixel,frame\)/);
  assert.match(VIS_SHADER, /in\.position\.xy,uni\.maskFrame/);
  assert.match(SHADOW_DEPTH_SHADER, /in\.position\.xy,0\.0/);
  assert.match(SMALL_SHADER, /pixel,uni\.maskFrame/);
  assert.match(VIS_UNIFORMS_WGSL, /maskFrame:f32,padMask0:f32,padMask1:f32,padMask2:f32/);
});

test('BARY_WEIGHTS_WGSL déclare fn baryWeights une seule fois dans l’ombrage, jamais dans le raster', () => {
  assert.match(BARY_WEIGHTS_WGSL, /fn baryWeights\(/);
  eachOnce(BARY_WEIGHTS_WGSL, { SHADE_SHADER });
  // Le raster décide la couverture sur ses trois arêtes, pas sur des poids dérivés.
  assert.doesNotMatch(SMALL_SHADER, /baryWeights/);
});

// Défaut 7 : en filtrage linéaire sous `Repeat`, la couture d'une période doit mêler le dernier
// texel et le premier. La règle de référence est `lineaireThree` (test/justesse/adressageCas.mjs),
// écrite indépendamment de `wrapLinear` et déjà vérifiée contre les vrais échantillonneurs WebGL2 et
// WebGPU par `test/justesse/adressage-gpu.mjs` : le rang bas vient de la coordonnée décalée d'un
// demi-texel, et chacun des deux rangs subit le mode pour lui-même (OpenGL ES 3.0 § 3.8.10, la même
// règle que WebGPU). La recopier ici en faisait une troisième écriture de la même règle.
const regle = lineaireThree as (
  t: number,
  taille: number,
  wrap: THREE.Wrapping,
) => [number, number, number];
/** La valeur que les deux texels mêlés rendent : l'ordre des prises n'est pas imposé, la couleur si. */
const valeur = ([i0, i1, poids]: [number, number, number]) => i0 * (1 - poids) + i1 * poids;

test('wrapLinear mêle les deux texels de la règle, couture d’une période comprise', () => {
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
          Math.abs(valeur(wrapLinear(t, taille, wrap)) - valeur(attendu)) <= 1e-9,
          `${taille} texels, t=${t} : règle ${attendu}, lu ${wrapLinear(t, taille, wrap)}`,
        );
      }
  assert.ok(couture > 100, `la série doit éprouver la couture, ${couture} cas seulement`);
});

// Le repli d'une coordonnée ne peut pas reboucler une période : les deux prises et leur poids sont
// donc portés jusqu'aux lectures d'atlas, qui mêlent quatre lectures sur la couture et une seule
// ailleurs. Une lecture qui reprendrait la coordonnée repliée seule rouvrirait le défaut.
test('les lectures d’atlas reçoivent le quartet de leur carte et mêlent quatre prises', () => {
  assert.match(
    WRAP_COORD_WGSL,
    /struct WrapTaps\{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,\}/,
  );
  for (const [nom, bloc] of Object.entries({
    COLOR_SAMPLE_WGSL,
    MASK_ALPHA_WGSL: maskAlphaWgsl(true),
    DATA_SAMPLE_WGSL,
  })) {
    assert.match(bloc, /,uv:vec2f,wrap:u32/, `${nom} doit recevoir le quartet de sa carte`);
    assert.match(bloc, /if\(!t\.couture\)\{return /, `${nom} doit garder la lecture unique`);
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
    // Une lecture d'atlas (`let t=wrapUv(`) ou le retour d'image qui la nomme (`return wrapUv(`) :
    // la coordonnée que le pixel demande est celle qu'il lit.
    assert.equal(
      occurrences(texte, 'wrapUv('),
      occurrences(texte, 'fn wrapUv(') +
        occurrences(texte, 'let t=wrapUv(') +
        occurrences(texte, 'return wrapUv('),
      `${nom} ne replie une coordonnée que dans une lecture d'atlas, jamais pour son compte`,
    );
});
