// #1335, #1336: the card both GPU paths draw reads the octahedral atlas with ONE arithmetic, on the
// CPU (`sdk-core/src/impostor/octahedron.ts`, the compiler's `octahedron.rs` oracle), in the shipped
// WGSL (`impostorWgsl.ts`) and in its GLSL twin (`impostorGlsl.ts`). The tests run each shader text
// itself through the software shader harness. Fails on develop: neither text is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPOSTOR_CARD_WGSL } from './impostorWgsl.ts';
import { IMPOSTOR_VIEW_CARD_GLSL } from './impostorGlsl.ts';
import { runShaderText } from './shaderText.fixture.ts';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import { cellWeights, octDecode, octEncode } from '../../../../sdk-core/src/impostor/octahedron.ts';

/** The functions of one shipped shader text, as the software harness runs them. */
function runnersOf(text: string) {
  const shaderOf = (name: string) => functionsOf(text, [name]);
  const impSide = runShaderText<number>(shaderOf('impSide'));
  return {
    encode: runShaderText<number[]>(shaderOf('impOctEncode'), { impSide }),
    decode: runShaderText<number[]>(shaderOf('impOctDecode'), { impSide }),
    weights: runShaderText<number[]>(shaderOf('impWeights')),
  };
}
const LANGUAGES = { wgsl: runnersOf(IMPOSTOR_CARD_WGSL), glsl: runnersOf(IMPOSTOR_VIEW_CARD_GLSL) };

for (const [language, run] of Object.entries(LANGUAGES)) {
  // The three-frame weights sum to one on both triangles of a cell, as #817's compiler test proves.
  test(`the ${language} card weights sum to one and are the barycentric coordinates of the cell`, () => {
    for (const [fx, fy] of [
      [0.1, 0.2],
      [0.9, 0.4],
      [0.5, 0.5],
      [0.0, 0.75],
      [0.33, 0.66],
    ]) {
      const weights = run.weights([fx, fy]),
        oracle = cellWeights([7 + fx, 3 + fy], 12).map((cell) => cell.weight);
      assert.ok(Math.abs(weights[0] + weights[1] + weights[2] - 1) < 1e-9, `${fx},${fy} sums`);
      for (let k = 0; k < 3; k++)
        assert.ok(Math.abs(weights[k] - oracle[k]) < 1e-9, `${fx},${fy} weight ${k}`);
    }
  });

  // Direction → uv → direction matches the oracle at every step, for both mappings, on the
  // lattices #817 captures.
  test(`the octahedral mapping in ${language} matches the oracle on both grids`, () => {
    for (const hemi of [0, 1])
      for (const n of [5, 12])
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const f = [i / (n - 1), j / (n - 1)],
              cpuDir = octDecode(f, hemi === 1),
              shaderDir = run.decode(f, hemi);
            for (let k = 0; k < 3; k++)
              assert.ok(
                Math.abs(cpuDir[k] - shaderDir[k]) < 1e-6,
                `decode ${hemi} ${i},${j} [${k}]`,
              );
            const cpuUv = octEncode(cpuDir, hemi === 1),
              shaderUv = run.encode(cpuDir, hemi);
            for (let k = 0; k < 2; k++)
              assert.ok(Math.abs(cpuUv[k] - shaderUv[k]) < 1e-6, `encode ${hemi} ${i},${j} [${k}]`);
          }
  });
}
