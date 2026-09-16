// La règle de normale d'un matériau à deux faces, commune aux deux passes qui éclairent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_DOUBLE, FLAG_HAS_NORMAL, SHADE_SHADER } from './visibilityBuffer.ts';
import { BLEND_SHADER } from './webgpuPagesShaders.ts';

/** Le corps de la branche de la normale de sommet, celle qui suit la normale géométrique. */
function vertexNormalBranch(wgsl: string) {
  const geometric = wgsl.indexOf('var N=uniteOuZero(');
  assert.notEqual(geometric, -1, 'le nuanceur part bien d’une normale géométrique');
  const start = wgsl.indexOf(`&${FLAG_HAS_NORMAL}u)!=0u){`, geometric);
  assert.notEqual(start, -1, 'la normale de sommet a bien sa branche');
  let depth = 0;
  const open = wgsl.indexOf('{', start);
  for (let i = open; i < wgsl.length; i++) {
    if (wgsl[i] === '{') depth++;
    else if (wgsl[i] === '}' && --depth === 0) return wgsl.slice(open + 1, i);
  }
  throw new Error('branche de normale non fermée');
}

test('seule une normale de sommet se retourne sur le dos d’un matériau à deux faces', () => {
  // La normale géométrique regarde déjà l'observateur — dérivées d'écran pour le mélange, arêtes
  // remises d'endroit par `screenFace` pour l'opaque. La retourner l'enverrait à l'opposé de la
  // lumière, et une vitre à deux faces vue de dos rendrait exactement zéro. Le retournement vit
  // donc dans la branche de la normale de sommet, et nulle part ailleurs, des deux côtés.
  for (const [nom, wgsl] of [
    ['mélange', BLEND_SHADER],
    ['opaque', SHADE_SHADER],
  ] as Array<[string, string]>) {
    assert.match(
      vertexNormalBranch(wgsl),
      /N\*=face;/,
      `${nom} : la normale de sommet se retourne`,
    );
    assert.equal(
      wgsl.split('N*=face;').length - 1,
      1,
      `${nom} : un seul retournement de normale dans tout le nuanceur`,
    );
  }
  // Le repère tangent suit la même règle : il ne se retourne qu'avec la normale qui l'oriente.
  const tangent = new RegExp(
    `&${FLAG_DOUBLE}u\\)!=0u&&\\([a-z]+\\.flags&${FLAG_HAS_NORMAL}u\\)!=0u\\)\\{T\\*=face;B\\*=face;\\}`,
  );
  for (const [nom, wgsl] of [
    ['mélange', BLEND_SHADER],
    ['opaque', SHADE_SHADER],
  ] as Array<[string, string]>)
    assert.match(wgsl, tangent, `${nom} : le repère tangent ne se retourne qu’avec une normale`);
});
