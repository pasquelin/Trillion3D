// Cases of defect 6: four named deterministic cases, then a statistical sample of at least
// 3072 cases on the axes that vary the determinant — uniform scale from 1e-3 to 1e-16,
// non-uniform scale (witness excluded by conformity), large local coordinates, realistic world
// size object, and a reflection (negative determinant) on half the cases.
import assert from 'node:assert/strict';
import { construireCas } from './inverseTransposeCas.ts';

// --- The deterministic counter-example --------------------------------------------------------
// 180° rotation around X: the local axis (0,0,1) becomes (0,0,-1), exactly the camera direction
// (0,0,-9) from the origin. The two triangles are therefore actually face-on after rotation.
// Below s ≈ 2.15e-7 (det = s³ < 1e-20), the absolute threshold kept the *local* axis (0,0,1) —
// which points, itself, opposite the camera — and rejected the cluster.
export const CONTRE_EXEMPLE = construireCas({
  s: 1e-8,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});
// Large-scale witness: same geometry, same rotation, s outside the guard zone (det ≫ 1e-20).
export const TEMOIN_GRANDE_ECHELLE = construireCas({
  s: 1e-3,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});
// Witness without rotation: same tiny scale, but the local axis already coincides with the world
// axis. The two triangles are then actually back to the camera: rejection is correct, before as
// after, and it must stay so — the fix does not loosen legitimate rejection.
export const TEMOIN_SANS_ROTATION = construireCas({
  s: 1e-8,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 0,
});
// Non-conformal witness: same rotation and same tiny scale, but non-uniform scale — conformity
// (defect 1) excludes it before `inverseTranspose3`; never rejected by the cone.
export const TEMOIN_NON_CONFORME = construireCas({
  s: 1e-8,
  kind: 'non-uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});

export const DETERMINISTES = [
  ['contreExemple', CONTRE_EXEMPLE],
  ['temoinGrandeEchelle', TEMOIN_GRANDE_ECHELLE],
  ['temoinSansRotation', TEMOIN_SANS_ROTATION],
  ['temoinNonConforme', TEMOIN_NON_CONFORME],
];

// --- The statistical sample -------------------------------------------------------------------
// 1e-3 to 1e-6 sit outside the absolute-threshold band (det = s³ ≥ 1e-18): they serve as a
// non-regression witness. 1e-7 to 1e-16 sit inside; 1e-12 and 1e-16 go past the point where s³
// itself becomes denormal in f32, which only 3×3 normalisation crosses.
export const SCALES = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16];
/** Scales where `det = ±s³` stays above the absolute 1e-20 threshold: the batch changes nothing there. */
export const HORS_BANDE = SCALES.filter((s) => s * s * s >= 1e-20);
const KINDS = ['uniforme', 'non-uniforme'];
const WORLD_SIZES = [1, 4];
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
  [1, -1, 0.5],
];
const ANGLES = Array.from({ length: 12 }, (_, i) => 10 + (i * 160) / 11);

export const echantillon = [];
for (const s of SCALES)
  for (const kind of KINDS)
    for (const worldSize of WORLD_SIZES)
      for (const axis of AXES)
        for (const angleDeg of ANGLES)
          for (const miroir of [false, true])
            echantillon.push(construireCas({ s, kind, worldSize, axis, angleDeg, miroir }));
assert.ok(echantillon.length >= 3072, `sample too small: ${echantillon.length}`);

export const tousLesCas = [...DETERMINISTES.map(([, c]) => c), ...echantillon];
