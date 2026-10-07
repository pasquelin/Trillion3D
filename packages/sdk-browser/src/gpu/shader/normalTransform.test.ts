// `NORMAL_TRANSFORM_WGSL` (../lighting/standardLighting.ts): the lighting normal transformation
// shares `inverseTranspose3` with the selection kernel, whose threshold is relative. An absolute
// threshold `abs(det)<1e-20` on the raw determinant would fail: a uniform scale
// rotation s has determinant ±s³, so as soon as s ≲ 2.15e-7 the rendered normal would be the LOCAL
// normal, unrotated, and the surface would read as if unrotated.
//
// WHAT THIS FILE HOLDS, AND HOW. It reads no shader text with regex patterns: a suite of
// `assert.match` on WGSL breaks on first reformat and guarantees no arithmetic. It tests
// CALCULATION — `xformNormal` = uniteOuZero(inverseTranspose3(mat3(world), n)) — on f32 model from
// `tests/gpu/math/inverseTransposeF32.ts`: rotation tracked across all scales, singular poses —
// flattened then collapsed — and threshold crossed on both sides.
// This model is not the shader: `tests/gpu/math/normal-transform.gpu.ts` executes text
// shipped on Dawn on EXACTELY these cases (`tests/gpu/math/normalTransformCases.ts`) and
// mandates rendering what model renders — which is also where non-compiling shader fails proof.
// Only text checks remaining here cover COMPILATION and single writing: duplicate declaration
// would not compile, and two arithmetic copies would drift. CRITERION judging
// a rendered normal is tested separately in `normalTransformCriterion.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { INVERSE_TRANSPOSE_SHIPPED } from './inverseTransposeBefore.fixture.ts'
import { NORMAL_TRANSFORM_WGSL as NORMAL_TRANSFORM } from '../../lighting/standardLighting.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { DAG_SELECTION_SHADER } from '../dag/shader/shader.ts'
import {
  DROPOUT_DEG,
  angleBetween,
  unit,
  normalVerdict,
  xformNormalBefore,
  xformNormalModel,
} from '../../../../../tests/gpu/math/inverseTransposeF32.ts'
import {
  FLATTENED,
  CASES,
  COLLAPSED,
  TINY_REGULAR,
  THRESHOLD_SCALE,
} from '../../../../../tests/gpu/math/normalTransformCases.ts'
import { RAD2DEG } from '../../../../math/src/constants.ts'

/** The lighting normal transformation, as a program holds it. */
const NORMAL_TRANSFORM_WGSL = wgslModule(NORMAL_TRANSFORM)

/** Verdict — oriented direction, zero vector rejected, unit norm — of a write on a case. */
const verdict = (cas: { truth: number[] }, rendered: number[]) =>
  normalVerdict(rendered, cas.truth, DROPOUT_DEG)

test('lighting normal follows rotation at all scales, from 1e3 to 1e-16', () => {
  assert.ok(CASES.length >= 300, `sample too small : ${CASES.length}`)
  for (const cas of CASES) {
    const v = verdict(cas, xformNormalModel(cas.world, cas.normal))
    assert.ok(v.ok, `${cas.name} : ${v.reason}`)
  }
  // Without effective rotation, these cases prove nothing: true normal must have moved.
  const tournees = CASES.filter((cas) => angleBetween(cas.truth, cas.normal) * RAD2DEG > 10).length
  assert.ok(tournees > CASES.length / 2, `only ${tournees} cases rotate normal`)
})

test('absolute threshold before batch dropped out, and exactly below s³ = 1e-20', () => {
  const decroches = CASES.filter(
    (cas) => !verdict(cas, xformNormalBefore(cas.world, cas.normal)).ok,
  )
  assert.ok(decroches.length > 0, 'reproduction no longer reproduces: review cases')
  // What batch was meant to change, and nothing else: above threshold, old code was already correct.
  // Dropout outside band would mean bug was not what we thought.
  for (const cas of decroches)
    assert.ok(
      cas.s < THRESHOLD_SCALE,
      `${cas.name} : dropout outside threshold band (s = ${cas.s} ≥ ${THRESHOLD_SCALE})`,
    )
  // And across threshold, behavior toggles: 2.154e-7 inside, 2.16e-7 outside.
  // Without these two scales, bound would not be tested, only crossed from afar.
  const a = (s: number) => decroches.some((cas) => cas.s === s)
  assert.ok(a(2.154e-7), 'just below threshold: former code should have dropped out')
  assert.ok(!a(2.16e-7), 'just above threshold: former code should not have dropped out')
})

test('outside threshold band, batch did not move rendered normal', () => {
  for (const cas of CASES.filter((c) => c.s >= 1e-6)) {
    const gap =
      angleBetween(
        xformNormalModel(cas.world, cas.normal),
        xformNormalBefore(cas.world, cas.normal),
      ) * RAD2DEG
    assert.ok(gap < 1e-4, `${cas.name} : normal moved by ${gap}° outside band`)
  }
})

test('singular poses: flattened face keeps normal, collapsed face has none', () => {
  // One expectation per case, calculated by hand in `normalTransformCases.ts`: cross product of
  // transformed edges for rank 2, zero vector for collapsed. Former expectation — LOCAL normal
  // rendered as is — described bug, not convention: on `scale (1,1,0) then 90° around Y` it left +Z
  // where transformed face looks at +X.
  for (const cas of FLATTENED) {
    const v = verdict(cas, xformNormalModel(cas.world, cas.normal))
    assert.ok(v.ok, `${cas.name} : ${v.reason}`)
    const gap = angleBetween(cas.truth, unit(cas.normal)) * RAD2DEG
    assert.ok(gap > 10, `${cas.name} : local and true normals differ by only ${gap}°`)
  }
  for (const cas of COLLAPSED)
    assert.deepEqual(
      xformNormalModel(cas.world, cas.normal),
      [0, 0, 0],
      `${cas.name} : face without world area does not light — zero, never NaN nor local`,
    )
  // And guard must not be greedy: tiny but regular matrix passes.
  const v = verdict(TINY_REGULAR, xformNormalModel(TINY_REGULAR.world, TINY_REGULAR.normal))
  assert.ok(v.ok, `${TINY_REGULAR.name} : caught by guard — ${v.reason}`)
})

// --- Single writing and compilation --------------------------------------------------------------
const occurrences = (text: string, motif: RegExp) => text.match(motif)?.length ?? 0

test('selection kernel and lighting read exact same text, character for character', () => {
  // The selection kernel lists the two functions it calls, the lighting the whole kernel and its
  // unit-or-zero: each program holds the library's text of what it calls, once. A test-only check
  // of what the assembler guarantees, read on the programs' final text.
  for (const [nom, shader, calls] of [
    [
      'lighting',
      NORMAL_TRANSFORM_WGSL,
      ['inverseTranspose3', 'invTranspose3Prep', 'invTranspose3Apply', 'uniteOuZero'],
    ],
    ['DAG selection', DAG_SELECTION_SHADER, ['invTranspose3Prep', 'invTranspose3Apply']],
  ] as const) {
    for (const text of Object.values(INVERSE_TRANSPOSE_SHIPPED))
      assert.ok(shader.includes(text), `${nom} : shared text absent`)
    for (const fonction of calls)
      assert.equal(
        occurrences(shader, new RegExp(`fn ${fonction}\\(`, 'g')),
        1,
        `${nom} : « fn ${fonction} » declared twice, WGSL module would not compile`,
      )
  }
})

test('lighting normal passes through shared inverse-transpose, without recomputing it', () => {
  const corps = NORMAL_TRANSFORM_WGSL.split('fn xformNormal')[1].split('\n}')[0]
  assert.equal(occurrences(NORMAL_TRANSFORM_WGSL, /fn xformNormal\(/g), 1, 'xformNormal duplicated')
  assert.ok(corps.includes('inverseTranspose3('), 'xformNormal no longer calls shared kernel')
  assert.ok(corps.includes('uniteOuZero('), 'xformNormal must return unit or zero direction')
  assert.doesNotMatch(
    corps,
    /\bdet\b|cross\(/,
    'xformNormal recomputes inverse-transpose instead of calling it: that was Bug 9',
  )
})
