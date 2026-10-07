// Defect 6 (`inverseTranspose3` threshold, shader/shader.ts): a 3×3's degeneracy is judged
// on its NORMALISED determinant, never on the raw determinant. An absolute threshold judges
// scale: a uniform-scale rotation s has determinant ±s³, so s ≲ 2.15e-7 fell under 1e-20 and
// the kernel returned the unrotated local axis — cone rejection then culled front faces.
// Real GPU behaviour is proved by `tests/gpu/math/inverse-transpose-small-scale.gpu.ts`;
// this test replays the same f32 arithmetic so `pnpm test` catches the regression without GPU.
// The f32 model lives in `tests/gpu/math/inverseTransposeF32.ts`, shared with the lighting
// proof: one writing of the arithmetic, tied to the shader actually executed by
// `tests/gpu/math/normal-transform.gpu.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { SINGULAR_DETERMINANT } from '../../../../math/src/matrix/singular.ts'
import { SINGULAR_DETERMINANT as SINGULAR_DETERMINANT_DECL } from '../../../../math/src/wgsl/constants.ts'
import { isFiniteScale } from '../../../../math/src/wgsl/inverseTranspose.ts'
import {
  INVERSE_TRANSPOSE_BEFORE,
  INVERSE_TRANSPOSE_SHIPPED,
} from '../shader/inverseTransposeBefore.fixture.ts'
import {
  angleBetween,
  inverseTransposeShipped,
  inverseTransposeBefore,
  f,
  unit,
} from '../../../../../tests/gpu/math/inverseTransposeF32.ts'

type Vec = [number, number, number]

/** 180° rotation about X, uniform scale s: local axis (0,0,1) must become (0,0,-1). */
const tourneeDe180 = (s: number): [Vec, Vec, Vec] => [
  [f(s), 0, 0],
  [0, f(-s), 0],
  [0, 0, f(-s)],
]
const AXE: Vec = [0, 0, 1]

test('the absolute threshold returned the local axis as soon as s³ fell under 1e-20', () => {
  assert.deepEqual(unit(inverseTransposeBefore(tourneeDe180(1e-3), AXE)), [0, 0, -1])
  assert.deepEqual(unit(inverseTransposeBefore(tourneeDe180(1e-8), AXE)), [0, 0, 1])
})

test('the shipped kernel rotates the axis at every scale, from 1e6 to 1e-18', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16, 1e-18])
    assert.deepEqual(unit(inverseTransposeShipped(tourneeDe180(s), AXE)), [0, 0, -1], `scale ${s}`)
})

// Normalisation changes f32 rounding by a few ULPs: the direction returned outside the
// threshold band is therefore not bitwise the previous one, it is collinear to within
// 1e-6 radian. What matters is the reject decision, measured unchanged outside the band
// on a real GPU — see `tests/gpu/math/inverse-transpose-small-scale.gpu.ts`.
test('outside the threshold band, the returned direction matches the previous one to 1e-6 radian', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6])
    for (const axe of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.6, -0.8, 0],
    ] as Vec[]) {
      const m = tourneeDe180(s)
      const gap = angleBetween(inverseTransposeShipped(m, axe), inverseTransposeBefore(m, axe))
      assert.ok(gap < 1e-6, `scale ${s} axis ${axe}: delta ${gap} rad`)
    }
})

test('null, infinite or NaN 3×3: adjoint zeroed, hence null vector, never the local', () => {
  const zero: [Vec, Vec, Vec] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  assert.deepEqual(inverseTransposeShipped(zero, AXE), [0, 0, 0])
  for (const valeur of [Infinity, -Infinity, NaN]) {
    const abimee = tourneeDe180(1)
    abimee[0][0] = valeur
    assert.deepEqual(inverseTransposeShipped(abimee, AXE), [0, 0, 0])
  }
})

// A null column does not erase the primitive: it flattens it onto a PLANE, where the cone
// axis keeps a direction. `tourneeDe180(1e-8)` stripped of its Y column has columns
// (1e-8, 0, 0), (0,0,0) and (0, 0, −1e-8): the arrival plane is XZ, and the adjoint of
// the normalised 3×3 is mat3(0, (0, −0.25, 0), 0). Applied to local axis (0,0,1) it
// returns the NULL vector — the local axis is in the kernel —, applied to (0, 1, 0) it
// returns (0, −0.25, 0), i.e. −Y once unit. A fallback to the unrotated
// LOCAL axis would return it in both cases.
test('a null column: the adjoint carries the plane normal, not the local axis', () => {
  const zeroColumn = tourneeDe180(1e-8)
  zeroColumn[1] = [0, 0, 0]
  assert.deepEqual(inverseTransposeShipped(zeroColumn, AXE), [0, 0, 0])
  assert.deepEqual(unit(inverseTransposeShipped(zeroColumn, [0, 1, 0])), [0, -1, 0])
})

// Normalisation, determinant and adjoint depend only on the matrix: they live in
// `invTranspose3Prep`, computed once where several vectors undergo the same matrix.
// The degeneracy judgement has not moved for all that — that is what this test holds.
test('the shipped shader no longer carries an absolute threshold on the raw determinant', () => {
  const corps = DAG_SELECTION_SHADER.split('fn invTranspose3Prep')[1].split('\n}')[0]
  assert.doesNotMatch(corps, /abs\(det\)<1e-20/, 'absolute threshold on the raw determinant')
  assert.match(corps, /let a=m\[0\]\/t;let b=m\[1\]\/t;let c=m\[2\]\/t;/, 'normalisation absente')
  // And this number is not written in the shader: it is the declaration of the constant shared
  // with the CPU (`packages/math/src/matrix/singular.ts`), its f32 written once. A threshold
  // changed on one side only is impossible.
  assert.match(corps, /finite&&abs\(det\)>SINGULAR_DETERMINANT\)/, 'shared threshold')
  assert.ok(DAG_SELECTION_SHADER.includes(SINGULAR_DETERMINANT_DECL.text), 'threshold declared')
  const literal = /=([^;]+);$/.exec(SINGULAR_DETERMINANT_DECL.text)![1]
  assert.equal(
    Math.fround(Number(literal)),
    Math.fround(SINGULAR_DETERMINANT),
    'the declared threshold is no longer the CPU’s 1e-20',
  )
  assert.match(corps, /let finite=isFiniteScale\(t\);/, 'null, infinite or NaN sum not rejected')
  assert.match(
    isFiniteScale.text,
    /return \(t>0\.0\)&&\(bitcast<u32>\(t\)&0x7f800000u\)!=0x7f800000u;/,
    'null, infinite or NaN sum not rejected',
  )
  assert.match(
    DAG_SELECTION_SHADER,
    /let carried=p\.adj\*v;\n return select\(carried,p\.scale\*carried,p\.regular\);/,
    'a singular matrix must return the adjoint, not the local vector nor an infinite factor',
  )
  assert.match(
    corps,
    /select\(z,cross\(b,c\),finite\),select\(z,cross\(c,a\),finite\),select\(z,cross\(a,b\),finite\)/,
    'a non-finite sum must zero the adjoint: `m/t` is then worthless',
  )
})

// The pre-defect-6 form lives against the shipped kernel (`packages/math/src/wgsl/inverseTranspose.ts`), so
// the reproduction bench substitutes it instead of rebuilding it with a `String.replace`
// on a verbatim copy — a copy that stopped matching as soon as the kernel changed,
// unseen. A reproduction that does not reproduce reassures wrongly: this test holds
// what makes its value, the absolute threshold on the raw 3×3, present on one side and
// absent on the other. The substitution itself is established, not assumed, by
// `tests/gpu/math/substitutionBefore.ts`. The real GPU is measured by
// `tests/gpu/math/inverse-transpose-small-scale.gpu.ts`, which separates face culls the
// engine draws (656 before the lot, 0 after) from those it does not.
test('the defect-6 reproduction form still carries the absolute threshold, and it alone', () => {
  const prep = (text: string) => text.split('fn invTranspose3Prep')[1].split('\n}')[0]
  assert.match(prep(INVERSE_TRANSPOSE_BEFORE.prep), /abs\(det\)<1e-20/, 'absolute threshold')
  assert.doesNotMatch(prep(INVERSE_TRANSPOSE_BEFORE.prep), /let a=m\[0\]\/t/, 'normalised')
  assert.doesNotMatch(
    prep(INVERSE_TRANSPOSE_SHIPPED.prep),
    /abs\(det\)<1e-20/,
    'absolute threshold gone',
  )
  // The two forms differ in only TWO places, and both are needed: the prepare, and the
  // singular-matrix fallback. The defect was returning the LOCAL vector — that is what
  // the previous form must keep doing, or the reproduction would return the fixed normal
  // in the middle of the defect. Everything else is the same text, hence substituting
  // each function whole.
  const fallback = (text: string) =>
    text.split('let carried=p.adj*v;')[1].split(';')[0].replace('\n return select(', '')
  assert.equal(fallback(INVERSE_TRANSPOSE_BEFORE.apply), 'v,p.scale*carried,p.regular)')
  assert.equal(fallback(INVERSE_TRANSPOSE_SHIPPED.apply), 'carried,p.scale*carried,p.regular)')
  const head = (text: string) => text.slice(0, text.indexOf('{') + 1)
  assert.equal(head(INVERSE_TRANSPOSE_BEFORE.prep), head(INVERSE_TRANSPOSE_SHIPPED.prep))
  assert.equal(head(INVERSE_TRANSPOSE_BEFORE.apply), head(INVERSE_TRANSPOSE_SHIPPED.apply))
})
