// Lot formules communes : chaque fragment WGSL factorisé de `visibilityPageWgsl.ts` doit rester
// l'unique écriture de son identifiant, et chaque nuanceur qui l'assemble doit le porter une seule
// fois — deux copies dans un même texte seraient deux chances de le voir dériver, comme avant ce lot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_INFO_STRUCT_WGSL,
  EDGE_WGSL,
  PAGE_VERTEX_WGSL,
  PAGE_UV_WGSL,
  WRAP_COORD_WGSL,
  MASK_KEEP_WGSL,
  BARY_WEIGHTS_WGSL,
} from './visibilityPageWgsl.ts';
import { rasterSource } from './gpuSmallTrianglesShader.ts';
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
  eachOnce(PAGE_INFO_STRUCT_WGSL, { SMALL_SHADER, SHADE_SHADER, VIS_SHADER, SHADOW_DEPTH_SHADER });
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

test('BARY_WEIGHTS_WGSL déclare fn baryWeights une seule fois dans le raster et l’ombrage', () => {
  assert.match(BARY_WEIGHTS_WGSL, /fn baryWeights\(/);
  eachOnce(BARY_WEIGHTS_WGSL, { SMALL_SHADER, SHADE_SHADER });
});
