// Defect 4: `wrapTexel` (visibilityMath.ts) must follow the GPU's integer rule for
// the three addressing modes — the same as MIRRORED_REPEAT in OpenGL ES 3.0 / WebGPU: i = ⌊t·size⌋,
// then clamp, modulo one period (Repeat), or modulo two periods whose second is read backwards
// (MirroredRepeat). `texelThree` (test/justesse/adressageCas.ts) encodes that same rule
// independently; it is the oracle already checked against real WebGL2 and WebGPU samplers by
// `test/justesse/adressage-gpu.ts`, reused here to sweep cases that the frozen values
// do not write explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wrapTexel } from './visibilityMath.ts';
import { texelThree } from '../../test/justesse/adressageCas.ts';

const CLAMP = THREE.ClampToEdgeWrapping,
  REPEAT = THREE.RepeatWrapping,
  MIRROR = THREE.MirroredRepeatWrapping;

test('u = 1.25 on 4 texels in mirror reads texel 2: what the GPU actually reads', () => {
  assert.equal(wrapTexel(1.25, 4, MIRROR), 2);
  assert.equal(texelThree(1.25, 4, MIRROR), 2, 'the independent reference confirms the same texel');
});

test('the three modes against the reference, even and odd sizes, integers/negatives/half-texel/large', () => {
  const valeurs = [
    -1000.5, -1000, -3, -2, -1, -0.5, 0, 0.125, 0.5, 0.875, 1, 1.5, 2, 3, 999.5, 1000,
  ];
  for (const taille of [4, 5])
    for (const wrap of [CLAMP, REPEAT, MIRROR])
      for (const t of valeurs)
        assert.equal(
          wrapTexel(t, taille, wrap),
          texelThree(t, taille, wrap),
          `taille=${taille} wrap=${wrap} t=${t}`,
        );
});

test('u and v treated separately: sizes and modes independent per axis', () => {
  const u = [
    [1.25, 4, MIRROR],
    [-0.6, 5, REPEAT],
    [3.4, 4, CLAMP],
  ] as const;
  const v = [
    [-1.25, 5, MIRROR],
    [1.75, 4, REPEAT],
    [-2.2, 5, CLAMP],
  ] as const;
  for (const [tu, tailleU, wrapU] of u)
    for (const [tv, tailleV, wrapV] of v) {
      assert.equal(wrapTexel(tu, tailleU, wrapU), texelThree(tu, tailleU, wrapU), `u=${tu}`);
      assert.equal(wrapTexel(tv, tailleV, wrapV), texelThree(tv, tailleV, wrapV), `v=${tv}`);
    }
});

test('Repeat and ClampToEdge: frozen values, unchanged from before this batch', () => {
  assert.equal(wrapTexel(0.1, 4, REPEAT), 0);
  assert.equal(wrapTexel(0.9, 4, REPEAT), 3);
  assert.equal(wrapTexel(1.1, 4, REPEAT), 0);
  assert.equal(wrapTexel(-0.1, 4, REPEAT), 3);
  assert.equal(wrapTexel(-2, 4, CLAMP), 0);
  assert.equal(wrapTexel(0.5, 4, CLAMP), 2);
  assert.equal(wrapTexel(2, 4, CLAMP), 3);
});
