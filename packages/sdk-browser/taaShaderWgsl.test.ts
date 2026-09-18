import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAA_BINDINGS,
  TAA_REPROJECT_WGSL,
  TAA_SHADER,
  TAA_VIEW_BYTES,
  YCOCG_WGSL,
} from './taaShaderWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from './visibilityPageWgsl.ts';
import { ROW_PLACEMENT_WORD } from './webgpuPageRow.ts';
import { TAA_WEIGHTS } from './taaWeights.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('le nuanceur temporel assemble chaque fragment une fois, sur la fiche de page partagée', () => {
  for (const fragment of [YCOCG_WGSL, TAA_REPROJECT_WGSL])
    assert.equal(occurrences(TAA_SHADER, fragment), 1);
  assert.match(TAA_SHADER, /@vertex fn fullscreen\(/);
  assert.match(TAA_SHADER, /@fragment fn resolve\(/);
  // La fiche porte le placement au mot que la ligne écrit : c'est par lui que le pixel retrouve la
  // matrice de mouvement de son objet.
  const fields = PAGE_INFO_STRUCT_WGSL.replace(/^.*\{|,\}`?$/g, '').split(',');
  const words: string[] = [];
  for (const field of fields) {
    const [name, type] = field.split(':');
    const size = type === 'mat4x4f' ? 16 : type === 'vec4f' ? 4 : type === 'vec2f' ? 2 : 1;
    for (let i = 0; i < size; i++) words.push(name);
  }
  assert.equal(words[ROW_PLACEMENT_WORD], 'placement');
  assert.match(TAA_REPROJECT_WGSL, /motion\[pages\[\(id>>8u\)-1u\]\.placement\]/);
});

test('les liaisons du nuanceur sont celles de la disposition, et l’uniforme a la taille déclarée', () => {
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      TAA_SHADER,
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `liaison ${name}`,
    );
  // Deux matrices, viewport et params, puis les neuf poids en trois quadruplets.
  assert.equal(TAA_VIEW_BYTES, 2 * 64 + 2 * 16 + TAA_WEIGHTS * 4);
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,\}/,
  );
  // Aucun cosinus par pixel : les poids viennent de l'uniforme, voisin par voisin.
  assert.doesNotMatch(TAA_SHADER, /cos\(/);
  assert.match(TAA_SHADER, /view\.weights\[k>>2u\]\[k&3u\]/);
});

test('le fond, à profondeur nulle, se reprojette comme une direction et non comme un point', () => {
  // La position homogène est bâtie avec la profondeur lue telle quelle : à zéro — le plan lointain
  // infini de la profondeur inversée — le produit par l'inverse rend un point à l'infini, et la
  // reprojection le suit sans jamais diviser avant la matrice précédente.
  assert.match(TAA_REPROJECT_WGSL, /view\.invViewProj\*vec4f\(ndc,depthValue,1\.0\)/);
  // Rien n'est lu — ni identifiant, ni fiche, ni matrice — tant qu'aucun placement n'a bougé.
  assert.match(TAA_REPROJECT_WGSL, /if\(view\.params\.z!=0\.0\)\{\s*let id=textureLoad\(ids/);
  assert.match(TAA_REPROJECT_WGSL, /if\(previous\.w<=0\.0\)\{return vec3f\(0\.0,0\.0,0\.0\);\}/);
});
