// CRITERION for normal proofs, tested on manually chosen vectors without going through
// kernel. `angleEntre` and `verdictNormale` (`tests/browser/probes/inverseTransposeF32.ts`) decide if a
// rendered normal is correct: as long as they accept a reversed or lost normal, none of
// proofs relying on them — `normalTransform.test.ts` without GPU,
// `tests/browser/renders/normal-transform-arithmetic.browser.ts` on real GPU — proves anything. That was
// the case: absolute value on dot product confused N and −N, and `atan2(0, 0) = 0`
// declared correct a normal that shader had lost.
//
// Separated from `normalTransform.test.ts` by responsibility: there kernel arithmetic, here
// instrument judging it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleEntre,
  TOLERANCE_NORME,
  verdictNormale,
  xformNormalModele,
} from '../../../../tests/browser/probes/inverseTransposeF32.ts';
import {
  DECROCHE_DEG,
  REGULIERE_MINUSCULE,
} from '../../../../tests/browser/probes/normalTransformCases.ts';

/** Verdict — oriented direction, zero vector rejected, unit norm — of a write on a case. */
const verdict = (cas: { vraie: number[] }, rendue: number[]) =>
  verdictNormale(rendue, cas.vraie, DECROCHE_DEG);

test('angleEntre/verdictNormale: ORIENTED direction, N and −N no longer confused (correctness)', () => {
  const N = [0, 0, 1];
  const moinsN = [0, 0, -1];
  assert.ok(Math.abs(angleEntre(N, N)) < 1e-12, 'two identical directions: null angle');
  assert.ok(
    Math.abs(angleEntre(N, moinsN) - Math.PI) < 1e-12,
    'two opposite directions: π, not 0 as under an absolute value of the dot product',
  );
  const oppose = verdict({ vraie: N }, moinsN);
  assert.ok(!oppose.ok, 'a normal returned opposite the expected one must be refused');
  assert.ok(Math.abs(oppose.ecartDeg - 180) < 1e-9, `gap ${oppose.ecartDeg}°, expected 180°`);
});

test('angleEntre/verdictNormale: zero or non-finite vector yields NaN, never 0 (correctness)', () => {
  for (const v of [
    [0, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [0, -Infinity, 0],
  ])
    assert.ok(Number.isNaN(angleEntre(v, [0, 0, 1])), `angleEntre([${v}], N) must be NaN`);
  const rendueNulle = verdict({ vraie: [0, 0, 1] }, [0, 0, 0]);
  assert.ok(!rendueNulle.ok, 'a null vector is refused, never accepted at 0°');
  assert.ok(Number.isNaN(rendueNulle.ecartDeg), 'NaN gap, never 0° like atan2(0, 0)');
  assert.match(rendueNulle.raison ?? '', /no direction/, `raison : ${rendueNulle.raison}`);
});

test('verdictNormale: non-unit norm is rejected even in right direction (correctness)', () => {
  const tropCourte = verdict({ vraie: [0, 0, 1] }, [0, 0, 0.9]);
  assert.ok(!tropCourte.ok, 'a non-unit normal must be refused, even if perfectly aligned');
  assert.match(tropCourte.raison ?? '', /not unit/, `unexpected reason: ${tropCourte.raison}`);
  const dansLaTolerance = verdict({ vraie: [0, 0, 1] }, [0, 0, 1 + 1e-7]);
  assert.ok(dansLaTolerance.ok, `1e-7 under ${TOLERANCE_NORME}: must not be refused`);
});

test(
  'REGULIERE_MINUSCULE: inverse-transpose computed by hand, independently of the kernel, yields ' +
    '[0.6 ; 0.8 ; 0] (geometric correctness)',
  () => {
    // diag(1e-8, −1e-8, −1e-8) is its own transpose; its inverse is diag(1e8, −1e8, −1e8).
    // Applied to local normal [0.6, −0.8, 0]: [0.6·1e8, −0.8·(−1e8), 0] = [6e7, 8e7, 0].
    // Plain double arithmetic, without `Math.fround` or `cofacteur`: this calculation reuses nothing
    // from tested kernel, serving as independent witness.
    const brut = [0.6 * 1e8, -0.8 * -1e8, 0];
    const norme = Math.hypot(brut[0], brut[1], brut[2]);
    const main = [brut[0] / norme, brut[1] / norme, brut[2] / norme];
    assert.deepEqual(
      main,
      [0.6, 0.8, 0],
      'the hand computation does not land on the expected value',
    );
    assert.deepEqual(REGULIERE_MINUSCULE.vraie, main, 'the witness departs from the hand value');
    const rendue = xformNormalModele(REGULIERE_MINUSCULE.world, REGULIERE_MINUSCULE.normale);
    const v = verdictNormale(rendue, main, DECROCHE_DEG);
    assert.ok(
      v.ok,
      `${REGULIERE_MINUSCULE.nom}: the kernel returns [${rendue}], instead of [${main}] — ${v.raison}`,
    );
  },
);
