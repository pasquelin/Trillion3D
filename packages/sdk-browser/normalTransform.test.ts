// Bug 9 (`NORMAL_TRANSFORM_WGSL`, standardLighting.ts): lighting normal transformation
// carried its own copy of `inverseTranspose3`, with absolute threshold `abs(det)<1e-20`
// on raw determinant that Bug 6 had already corrected in selection kernel. Uniform scale
// rotation s has determinant ±s³: as soon as s ≲ 2.15e-7, rendered normal was LOCAL normal,
// unrotated, and surface was reads as if unrotated.
//
// WHAT THIS FILE HOLDS, AND HOW. It no longer reads shader text with regex patterns: a suite of
// `assert.match` on WGSL breaks on first reformat and guarantees no arithmetic. It tests
// CALCULATION — `xformNormal` = uniteOuZero(inverseTranspose3(mat3(world), n)) — on f32 model from
// `test/justesse/inverseTransposeF32.ts`: rotation tracked across all scales, singular poses —
// flattened then collapsed — and threshold crossed on both sides.
// This model is not the shader: `test/browser/normal-transform-arithmetique.browser.ts` executes text
// shipped in Chromium WebGPU on EXACTELY these cases (`test/justesse/normalTransformCas.ts`) and
// mandates rendering what model renders — which is also where non-compiling shader fails proof.
// Only text checks remaining here cover COMPILATION and single writing: duplicate declaration
// would not compile, and two arithmetic copies would drift — exactly Bug 9. CRITERION judging
// a rendered normal is tested separately in `normalTransformCritere.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import {
  angleEntre,
  unitaire,
  verdictNormale,
  xformNormalAvantLeLot,
  xformNormalModele,
} from '../../test/justesse/inverseTransposeF32.ts';
import {
  APLATIES,
  CAS,
  DECROCHE_DEG,
  DEG,
  EFFONDREES,
  REGULIERE_MINUSCULE,
  SEUIL,
} from '../../test/justesse/normalTransformCas.ts';

/** Verdict — oriented direction, zero vector rejected, unit norm — of a write on a case. */
const verdict = (cas: { vraie: number[] }, rendue: number[]) =>
  verdictNormale(rendue, cas.vraie, DECROCHE_DEG);

test('lighting normal follows rotation at all scales, from 1e3 to 1e-16', () => {
  assert.ok(CAS.length >= 300, `sample too small : ${CAS.length}`);
  for (const cas of CAS) {
    const v = verdict(cas, xformNormalModele(cas.world, cas.normale));
    assert.ok(v.ok, `${cas.nom} : ${v.raison}`);
  }
  // Without effective rotation, these cases prove nothing: true normal must have moved.
  const tournees = CAS.filter(
    (cas: { vraie: number[]; normale: number[] }) => angleEntre(cas.vraie, cas.normale) * DEG > 10,
  ).length;
  assert.ok(tournees > CAS.length / 2, `only ${tournees} cases rotate normal`);
});

test('absolute threshold before batch dropped out, and exactly below s³ = 1e-20', () => {
  const decroches = CAS.filter(
    (cas: { world: number[]; normale: number[]; vraie: number[] }) =>
      !verdict(cas, xformNormalAvantLeLot(cas.world, cas.normale)).ok,
  );
  assert.ok(decroches.length > 0, 'reproduction no longer reproduces: review cases');
  // What batch was meant to change, and nothing else: above threshold, old code was already correct.
  // Dropout outside band would mean bug was not what we thought.
  for (const cas of decroches)
    assert.ok(
      cas.s < SEUIL,
      `${cas.nom} : dropout outside threshold band (s = ${cas.s} ≥ ${SEUIL})`,
    );
  // And across threshold, behavior toggles: 2.154e-7 inside, 2.16e-7 outside.
  // Without these two scales, bound would not be tested, only crossed from afar.
  const a = (s: number) => decroches.some((cas: { s: number }) => cas.s === s);
  assert.ok(a(2.154e-7), 'just below threshold: former code should have dropped out');
  assert.ok(!a(2.16e-7), 'just above threshold: former code should not have dropped out');
});

test('outside threshold band, batch did not move rendered normal', () => {
  for (const cas of CAS.filter((c: { s: number }) => c.s >= 1e-6)) {
    const ecart =
      angleEntre(
        xformNormalModele(cas.world, cas.normale),
        xformNormalAvantLeLot(cas.world, cas.normale),
      ) * DEG;
    assert.ok(ecart < 1e-4, `${cas.nom} : normal moved by ${ecart}° outside band`);
  }
});

test('singular poses: flattened face keeps normal, collapsed face has none', () => {
  // One expectation per case, calculated by hand in `normalTransformCas.ts`: cross product of
  // transformed edges for rank 2, zero vector for collapsed. Former expectation — LOCAL normal
  // rendered as is — described bug, not convention: on `scale (1,1,0) then 90° around Y` it left +Z
  // where transformed face looks at +X.
  for (const cas of APLATIES) {
    const v = verdict(cas, xformNormalModele(cas.world, cas.normale));
    assert.ok(v.ok, `${cas.nom} : ${v.raison}`);
    const ecart = angleEntre(cas.vraie, unitaire(cas.normale)) * DEG;
    assert.ok(ecart > 10, `${cas.nom} : local and true normals differ by only ${ecart}°`);
  }
  for (const cas of EFFONDREES)
    assert.deepEqual(
      xformNormalModele(cas.world, cas.normale),
      [0, 0, 0],
      `${cas.nom} : face without world area does not light — zero, never NaN nor local`,
    );
  // And guard must not be greedy: tiny but regular matrix passes.
  const v = verdict(
    REGULIERE_MINUSCULE,
    xformNormalModele(REGULIERE_MINUSCULE.world, REGULIERE_MINUSCULE.normale),
  );
  assert.ok(v.ok, `${REGULIERE_MINUSCULE.nom} : caught by guard — ${v.raison}`);
});

// --- Single writing and compilation --------------------------------------------------------------
const occurrences = (texte: string, motif: RegExp) => texte.match(motif)?.length ?? 0;

test('selection kernel and lighting read exact same text, character for character', () => {
  for (const [nom, shader] of [
    ['lighting', NORMAL_TRANSFORM_WGSL],
    ['DAG selection', DAG_SELECTION_SHADER],
  ] as const) {
    assert.ok(shader.includes(INVERSE_TRANSPOSE_WGSL), `${nom} : shared text absent`);
    for (const fonction of [
      'inverseTranspose3',
      'invTranspose3Prep',
      'invTranspose3Apply',
      'uniteOuZero',
    ])
      assert.equal(
        occurrences(shader, new RegExp(`fn ${fonction}\\(`, 'g')),
        1,
        `${nom} : « fn ${fonction} » declared twice, WGSL module would not compile`,
      );
  }
});

test('lighting normal passes through shared inverse-transpose, without recomputing it', () => {
  const corps = NORMAL_TRANSFORM_WGSL.split('fn xformNormal')[1].split('\n}')[0];
  assert.equal(
    occurrences(NORMAL_TRANSFORM_WGSL, /fn xformNormal\(/g),
    1,
    'xformNormal duplicated',
  );
  assert.ok(corps.includes('inverseTranspose3('), 'xformNormal no longer calls shared kernel');
  assert.ok(corps.includes('uniteOuZero('), 'xformNormal must return unit or zero direction');
  assert.doesNotMatch(
    corps,
    /\bdet\b|cross\(/,
    'xformNormal recomputes inverse-transpose instead of calling it: that was Bug 9',
  );
});
