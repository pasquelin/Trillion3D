// #1239: the impostor switch, the card's three-frame weights and the octahedral mapping are ONE
// arithmetic, on the CPU (`sdk-core/src/impostor/switch.ts`, `octahedron.ts`) and in the shipped
// WGSL (`impostorWgsl.ts`). The tests run the WGSL text itself through the software shader harness,
// against #817's compiler oracle, over two meshes whose radius and root triangles differ: no
// constant is shared between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPOSTOR_CARD_WGSL, IMPOSTOR_MATH_WGSL, IMPOSTOR_SWITCH_WGSL } from './impostorWgsl.ts';
import { IMPOSTOR_CARD_GLSL } from './impostorGlsl.ts';
import { SPRITE_GLSL, SPRITE_WGSL } from './spriteWgsl.ts';
import { runShaderText } from './shaderText.fixture.ts';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import {
  IMPOSTOR_PI,
  drawsImpostor,
  impostorRadius,
  impostorSwitchDepth,
  impostorSwitchOf,
  impostorTexelDepth,
  impostorTriangleDepth,
  type ImpostorSwitchInput,
} from '../../../../sdk-core/src/impostor/switch.ts';
import { cellWeights, octDecode, octEncode } from '../../../../sdk-core/src/impostor/octahedron.ts';
import type { ImpostorMesh } from '../../../../sdk-core/src/contracts/impostor.ts';

/** Two meshes with different radius, root triangles, coverage and frame side (#817's formula). */
const MESHES: Array<ImpostorSwitchInput & { label: string }> = [
  { label: 'tree', objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 },
  { label: 'bush', objectRadius: 0.6, rootTriangles: 460, coverage: 0.66, frameSide: 64 },
];
const FOCALS = [900, 2146, 3000];

/** One function of one shipped shader text, as the software harness runs it. */
function shaderFn<R>(source: string, name: string, calls = {}) {
  return runShaderText<R>(functionsOf(source, [name]), calls);
}
const runSide = shaderFn<number>(IMPOSTOR_MATH_WGSL, 'impSide');
const runEncode = shaderFn<number[]>(IMPOSTOR_MATH_WGSL, 'impOctEncode', { impSide: runSide });
const runDecode = shaderFn<number[]>(IMPOSTOR_MATH_WGSL, 'impOctDecode', { impSide: runSide });
const runWeights = shaderFn<number[]>(IMPOSTOR_MATH_WGSL, 'impWeights');
// The switch text reads the shared constant; the harness binds it where the text names it.
const runSwitch = shaderFn<number>(IMPOSTOR_SWITCH_WGSL, 'impostorSwitchDepth', {
  IMPOSTOR_PI,
});

// z_s = max(2R·f/r_f, R·f·√(cπ/T)): the CPU oracle, the WGSL text and #817's formula agree, per
// mesh, and each mesh gets its own numbers.
test('the switch distance is the same on the CPU and in WGSL, and both follow #817', () => {
  const depths = new Map<string, number[]>();
  for (const mesh of MESHES) {
    const { objectRadius: R, rootTriangles: T, coverage: c, frameSide: rf } = mesh,
      seen: number[] = [];
    for (const focal of FOCALS) {
      const cpu = impostorSwitchDepth(mesh, focal),
        wgsl = runSwitch(
          mesh.objectRadius,
          mesh.rootTriangles,
          mesh.coverage,
          mesh.frameSide,
          focal,
        ),
        zTex = (2 * R * focal) / rf,
        zTri = R * focal * Math.sqrt((c * IMPOSTOR_PI) / T),
        formula = Math.max(zTex, zTri);
      assert.ok(Math.abs(cpu - formula) <= formula * 1e-12, `${mesh.label} CPU @${focal}`);
      assert.ok(
        Math.abs(cpu - wgsl) <= Math.abs(cpu) * 1e-5,
        `${mesh.label} WGSL @${focal}: ${wgsl} vs ${cpu}`,
      );
      // The two limits on their own, and the draw rule at `z >= z_s`.
      assert.ok(Math.abs(impostorTexelDepth(R, rf, focal) - zTex) <= zTex * 1e-12);
      assert.ok(Math.abs(impostorTriangleDepth(R, T, c, focal) - zTri) <= zTri * 1e-12);
      assert.equal(impostorRadius(R), R);
      assert.equal(impostorRadius(R, 2), 2 * R);
      assert.ok(drawsImpostor(mesh, focal, formula) && !drawsImpostor(mesh, focal, formula - 1));
      seen.push(cpu);
    }
    depths.set(mesh.label, seen);
  }
  // No constant is shared: the two meshes switch at different distances, and neither is the other's.
  for (let i = 0; i < FOCALS.length; i++) {
    const [tree, bush] = [depths.get('tree')![i], depths.get('bush')![i]];
    assert.ok(tree > bush, `tree switches beyond the bush at ${FOCALS[i]}`);
  }
});

// The three-frame weights sum to one on both triangles of a cell, as #817's compiler test proves.
test('the card weights sum to one and are the barycentric coordinates of the cell', () => {
  for (const [fx, fy] of [
    [0.1, 0.2],
    [0.9, 0.4],
    [0.5, 0.5],
    [0.0, 0.75],
    [0.33, 0.66],
  ]) {
    const weights = runWeights([fx, fy]),
      oracle = cellWeights([7 + fx, 3 + fy], 12).map((cell) => cell.weight);
    assert.ok(Math.abs(weights[0] + weights[1] + weights[2] - 1) < 1e-9, `${fx},${fy} sums`);
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(weights[k] - oracle[k]) < 1e-9, `${fx},${fy} weight ${k}`);
  }
});

// Direction → uv → direction round-trips within one part in a million, for both mappings, on the
// lattice #817 captures; the WGSL matches the compiler's `octahedron.rs` oracle at every step.
test('the octahedral mapping round-trips and matches the WGSL on both grids', () => {
  for (const hemi of [0, 1]) {
    for (const n of [5, 12]) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const f = [i / (n - 1), j / (n - 1)],
            cpuDir = octDecode(f, hemi === 1),
            wgslDir = runDecode(f, hemi);
          for (let k = 0; k < 3; k++)
            assert.ok(Math.abs(cpuDir[k] - wgslDir[k]) < 1e-6, `decode ${hemi} ${i},${j} [${k}]`);
          const cpuUv = octEncode(cpuDir, hemi === 1),
            wgslUv = runEncode(cpuDir, hemi);
          for (let k = 0; k < 2; k++)
            assert.ok(Math.abs(cpuUv[k] - wgslUv[k]) < 1e-6, `encode ${hemi} ${i},${j} [${k}]`);
          // uv back to the grid, then out to a direction the same as the one we started from.
          const grid = (uv: number[]) => [uv[0] * 0.5 + 0.5, uv[1] * 0.5 + 0.5],
            cpuBack = octDecode(grid(cpuUv), hemi === 1),
            wgslBack = runDecode(grid(wgslUv), hemi);
          for (let k = 0; k < 3; k++) {
            assert.ok(Math.abs(cpuBack[k] - cpuDir[k]) < 1e-6, `round ${hemi} ${i},${j} [${k}]`);
            assert.ok(Math.abs(wgslBack[k] - cpuDir[k]) < 1e-6, `round wgsl ${hemi} ${i},${j}`);
          }
        }
      }
    }
  }
});

/** A minimal baked entry: the three maps and the four numbers the switch reads. */
const baked: ImpostorMesh = {
  mesh: 1,
  sourceMesh: 1,
  name: 'tree',
  placements: 40,
  masked: true,
  rootTriangles: 2100,
  radius: 4.2,
  status: 'baked',
  coverage: 0.43,
  hemi: false,
  frames: 12,
  frameSide: 128,
  atlasSide: 1536,
  objectRadius: 4.2,
  switchDepth: { texel: 0, triangles: 0 },
  maps: {
    colourCoverage: { kind: 'coverage', levels: [] },
    normalDepth: { kind: 'data', levels: [] },
    orm: { kind: 'data', levels: [] },
  },
};

test('a baked mesh alone is eligible, on its own baked radius and triangles', () => {
  const input = impostorSwitchOf(baked, 2);
  assert.deepEqual(input, {
    objectRadius: 4.2,
    rootTriangles: 2100,
    coverage: 0.43,
    frameSide: 128,
    maxWorldScale: 2,
  });
  assert.equal(impostorSwitchOf({ ...baked, status: 'refused', maps: undefined }), undefined);
  assert.equal(impostorSwitchOf({ ...baked, rootTriangles: 0 }), undefined);
});

// The card is ONE text per backend: it shares the sprite basis (never a copy) and carries the
// switch and the three-frame blend the tests above proved.
test('the card shares the sprite basis and carries the switch and the blend', () => {
  for (const [card, sprite] of [
    [IMPOSTOR_CARD_WGSL, SPRITE_WGSL],
    [IMPOSTOR_CARD_GLSL, SPRITE_GLSL],
  ]) {
    assert.ok(card.includes(sprite), 'the shared sprite basis');
    assert.ok(card.includes('impostorSwitchDepth'), 'the one switch');
  }
  assert.ok(IMPOSTOR_CARD_WGSL.includes(IMPOSTOR_MATH_WGSL));
  assert.ok(IMPOSTOR_CARD_WGSL.includes('impBlend') && IMPOSTOR_CARD_GLSL.includes('impBlend'));
});
