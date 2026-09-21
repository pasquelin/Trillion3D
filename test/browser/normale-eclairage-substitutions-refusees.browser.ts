// This file exercises the proof CRITERION (`verdictNormale`), not only the shipped shader.
// `SUBSTITUTIONS` (`normaleEclairageGpu.ts`) alters `xformNormal`'s output at the exact
// place lighting reads it, on the real text compiled and run in Chromium WebGPU:
// `opposee` returns the flipped normal (N→−N, the most common inverse-transpose defect),
// `nulle` returns the lost normal (N→0). If `verdictNormale` let either through, it would
// protect nothing in `test/browser/normal-transform-arithmetique.browser.ts` — that is
// exactly what the OLD criterion did: an absolute value on the dot product confused N and
// −N, and `atan2(0, 0) = 0` declared a lost normal correct. `aucune` (the intact shader)
// is the witness in this same file: without it, a criterion that had become too strict
// would also go unnoticed.
//
// Ordinary cases (`CAS`) do not cover the kernel: `APLATIES` exercises the singular poses
// that still leave the face a world area, where the kernel must return the transformed
// FACE normal, and `REGULIERE_MINUSCULE` exercises the guard's non-greed witness — a
// tiny but regular rotation, which the guard must not confiscate. The substitution wraps
// the function's ENTIRE output, singular cases included: the same two mutations must
// therefore be refused there as surely as on ordinary cases.
//
// `EFFONDREES` stays OUTSIDE the three loops, and that is a property of the criterion,
// not a convenience: on a face with no world area the intact shader ALREADY returns the
// zero vector, so the N→0 mutation changes nothing and neither does N→−N. A mutation
// that cannot be seen proves nothing; those cases are exercised by their exact value in
// `test/browser/normal-transform-arithmetique.browser.ts`.
//
// node --experimental-strip-types test/browser/normale-eclairage-substitutions-refusees.browser.ts
import assert from 'node:assert/strict';
import { verdictNormale } from '../justesse/inverseTransposeF32.ts';
import {
  APLATIES,
  CAS,
  DECROCHE_DEG,
  EFFONDREES,
  REGULIERE_MINUSCULE,
} from '../justesse/normalTransformCas.ts';
import { SUBSTITUTIONS, eclairageGpu } from '../justesse/normaleEclairageGpu.ts';

/** Ordinary, flattened, and non-greed witness: the cases whose normal has a DIRECTION. */
const TOUS = [...CAS, ...APLATIES, REGULIERE_MINUSCULE];
/** The shader sees them too, so the executed text is exactly that of the other proof. */
const TOUTES = [...TOUS, ...EFFONDREES];

async function verdicts(substitution: (typeof SUBSTITUTIONS)[keyof typeof SUBSTITUTIONS]) {
  const gpu = await eclairageGpu(TOUTES, { substitution });
  assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
  assert.deepEqual(gpu.compilation ?? [], [], `substitution "${substitution}": compilation`);
  assert.deepEqual(gpu.erreurs ?? [], [], `substitution "${substitution}": GPU errors`);
  return TOUS.map((cas, i) => ({
    nom: cas.nom,
    verdict: verdictNormale(gpu.lignes[i].rendue, cas.vraie, DECROCHE_DEG),
  }));
}

const opposee = await verdicts(SUBSTITUTIONS.opposee);
const nulle = await verdicts(SUBSTITUTIONS.nulle);
const intacte = await verdicts(SUBSTITUTIONS.aucune);

console.log(
  JSON.stringify(
    {
      cas: TOUS.length,
      opposeeRefus: opposee.filter((l) => !l.verdict.ok).length,
      nulleRefus: nulle.filter((l) => !l.verdict.ok).length,
      intacteRefus: intacte.filter((l) => !l.verdict.ok).length,
    },
    null,
    2,
  ),
);

// N→−N: the flipped normal. The oriented criterion must refuse EVERY case, at ~180° from the true one.
for (const { nom, verdict } of opposee) {
  assert.ok(!verdict.ok, `${nom}: N→−N passes the criterion, it no longer distinguishes N from −N`);
  assert.ok(
    Math.abs(verdict.ecartDeg - 180) < 1e-2,
    `${nom}: N→−N at ${verdict.ecartDeg}°, expected ≈ 180°`,
  );
}

// N→0: the lost normal. `direction` refuses it before any angle — never a NaN that would pass,
// never an atan2(0,0) = 0 that would declare it correct as the old criterion did.
for (const { nom, verdict } of nulle) {
  assert.ok(!verdict.ok, `${nom}: N→0 passes the criterion, a lost normal is no longer detected`);
  assert.ok(
    Number.isNaN(verdict.ecartDeg),
    `${nom}: N→0 yields a gap of ${verdict.ecartDeg}°, expected NaN (no direction)`,
  );
  assert.match(
    verdict.raison ?? '',
    /no direction/,
    `${nom}: unexpected reason "${verdict.raison}"`,
  );
}

// The witness: the intact shader, on the same cases, stays green — otherwise the criterion is too strict.
for (const { nom, verdict } of intacte)
  assert.ok(verdict.ok, `${nom}: intact shader refused — ${verdict.raison}`);

console.log(
  `OK: ${TOUS.length} cases — N→−N refused ${opposee.length}/${opposee.length}, N→0 refused ` +
    `${nulle.length}/${nulle.length}, intact accepted ${intacte.length}/${intacte.length}.`,
);
