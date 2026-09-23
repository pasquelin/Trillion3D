// Defect 6 (`inverseTranspose3` threshold, shader/shader.ts): a 3×3's degeneracy is judged
// on its NORMALISED determinant, never on the raw determinant. An absolute threshold judges
// scale: a uniform-scale rotation s has determinant ±s³, so s ≲ 2.15e-7 fell under 1e-20 and
// the kernel returned the unrotated local axis — cone rejection then culled front faces.
// Real GPU behaviour is proved by `tests/browser/renders/inverse-transpose-small-scale.browser.ts`;
// this test replays the same f32 arithmetic so `pnpm test` catches the regression without GPU.
// The f32 model lives in `tests/browser/probes/inverseTransposeF32.ts`, shared with the lighting
// proof: one writing of the arithmetic, tied to the shader actually executed by
// `tests/browser/renders/normal-transform-arithmetic.browser.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from './shader/shader.ts';
import { SINGULAR_DETERMINANT_WGSL } from '../../../../sdk-core/src/index.ts';
import {
  INVERSE_TRANSPOSE_BEFORE_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../../math/inverseTransposeWgsl.ts';
import {
  angleEntre,
  apresLeLot,
  avantLeLot,
  f,
  unitaire,
} from '../../../../../tests/browser/probes/inverseTransposeF32.ts';

type Vec = [number, number, number];

/** 180° rotation about X, uniform scale s: local axis (0,0,1) must become (0,0,-1). */
const tourneeDe180 = (s: number): [Vec, Vec, Vec] => [
  [f(s), 0, 0],
  [0, f(-s), 0],
  [0, 0, f(-s)],
];
const AXE: Vec = [0, 0, 1];

test('the absolute threshold returned the local axis as soon as s³ fell under 1e-20', () => {
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-3), AXE)), [0, 0, -1]);
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-8), AXE)), [0, 0, 1]);
});

test('the shipped kernel rotates the axis at every scale, from 1e6 to 1e-18', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16, 1e-18])
    assert.deepEqual(unitaire(apresLeLot(tourneeDe180(s), AXE)), [0, 0, -1], `scale ${s}`);
});

// Normalisation changes f32 rounding by a few ULPs: the direction returned outside the
// threshold band is therefore not bitwise the previous one, it is collinear to within
// 1e-6 radian. What matters is the reject decision, measured unchanged outside the band
// on a real GPU — see `tests/browser/probes/inverse-transpose-small-scale.ts`.
test('outside the threshold band, the returned direction matches the previous one to 1e-6 radian', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6])
    for (const axe of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.6, -0.8, 0],
    ] as Vec[]) {
      const m = tourneeDe180(s);
      const ecart = angleEntre(apresLeLot(m, axe), avantLeLot(m, axe));
      assert.ok(ecart < 1e-6, `scale ${s} axis ${axe}: delta ${ecart} rad`);
    }
});

test('null, infinite or NaN 3×3: adjoint zeroed, hence null vector, never the local', () => {
  const nulle: [Vec, Vec, Vec] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  assert.deepEqual(apresLeLot(nulle, AXE), [0, 0, 0]);
  for (const valeur of [Infinity, -Infinity, NaN]) {
    const abimee = tourneeDe180(1);
    abimee[0][0] = valeur;
    assert.deepEqual(apresLeLot(abimee, AXE), [0, 0, 0]);
  }
});

// A null column does not erase the primitive: it flattens it onto a PLANE, where the cone
// axis keeps a direction. `tourneeDe180(1e-8)` stripped of its Y column has columns
// (1e-8, 0, 0), (0,0,0) and (0, 0, −1e-8): the arrival plane is XZ, and the adjoint of
// the normalised 3×3 is mat3(0, (0, −0.25, 0), 0). Applied to local axis (0,0,1) it
// returns the NULL vector — the local axis is in the kernel —, applied to (0, 1, 0) it
// returns (0, −0.25, 0), i.e. −Y once unit. The old fallback returned the unrotated
// LOCAL axis in both cases.
test('a null column: the adjoint carries the plane normal, not the local axis', () => {
  const colonneNulle = tourneeDe180(1e-8);
  colonneNulle[1] = [0, 0, 0];
  assert.deepEqual(apresLeLot(colonneNulle, AXE), [0, 0, 0]);
  assert.deepEqual(unitaire(apresLeLot(colonneNulle, [0, 1, 0])), [0, -1, 0]);
});

// Normalisation, determinant and adjoint depend only on the matrix: they live in
// `invTranspose3Prep`, computed once where several vectors undergo the same matrix.
// The degeneracy judgement has not moved for all that — that is what this test holds.
test('the shipped shader no longer carries an absolute threshold on the raw determinant', () => {
  const corps = DAG_SELECTION_SHADER.split('fn invTranspose3Prep')[1].split('\n}')[0];
  assert.doesNotMatch(corps, /abs\(det\)<1e-20/, 'absolute threshold on the raw determinant');
  assert.match(corps, /let a=m\[0\]\/t;let b=m\[1\]\/t;let c=m\[2\]\/t;/, 'normalisation absente');
  assert.match(corps, /fini&&abs\(det\)>1e-20/, 'garde relative absente');
  // And this number is not written in the shader: it comes from the constant shared with
  // the CPU (`packages/sdk-core/src/math/matrix/singular.ts`), rendered as text. A threshold changed on one side only is
  // impossible.
  assert.equal(
    SINGULAR_DETERMINANT_WGSL,
    '1e-20',
    'the rendered threshold is no longer the shader’s',
  );
  assert.match(
    corps,
    new RegExp(`fini&&abs\\(det\\)>${SINGULAR_DETERMINANT_WGSL}`),
    'shared threshold',
  );
  assert.match(
    corps,
    /let fini=\(t>0\.0\)&&\(bitcast<u32>\(t\)&0x7f800000u\)!=0x7f800000u;/,
    'null, infinite or NaN sum not rejected',
  );
  assert.match(
    DAG_SELECTION_SHADER,
    /let porte=p\.adj\*v;\n return select\(porte,p\.facteur\*porte,p\.regulier\);/,
    'a singular matrix must return the adjoint, not the local vector nor an infinite factor',
  );
  assert.match(
    corps,
    /select\(z,cross\(b,c\),fini\),select\(z,cross\(c,a\),fini\),select\(z,cross\(a,b\),fini\)/,
    'a non-finite sum must zero the adjoint: `m/t` is then worthless',
  );
});

// The pre-defect-6 form lives against the shipped kernel (`../../math/inverseTransposeWgsl.ts`), so
// the reproduction bench substitutes it instead of rebuilding it with a `String.replace`
// on a verbatim copy — a copy that stopped matching as soon as the kernel changed,
// unseen. A reproduction that no longer reproduces reassures wrongly: this test holds
// what makes its value, the absolute threshold on the raw 3×3, present on one side and
// absent on the other. The substitution itself is established, not assumed, by
// `tests/browser/probes/substitutionBefore.ts`. The real GPU is measured by
// `tests/browser/probes/inverse-transpose-small-scale.ts`, which separates face culls the
// engine draws (656 before the lot, 0 after) from those it does not.
test('the defect-6 reproduction form still carries the absolute threshold, and it alone', () => {
  const prep = (texte: string) => texte.split('fn invTranspose3Prep')[1].split('\n}')[0];
  assert.match(prep(INVERSE_TRANSPOSE_BEFORE_WGSL), /abs\(det\)<1e-20/, 'seuil absolu');
  assert.doesNotMatch(prep(INVERSE_TRANSPOSE_BEFORE_WGSL), /let a=m\[0\]\/t/, 'normalised');
  assert.doesNotMatch(prep(INVERSE_TRANSPOSE_WGSL), /abs\(det\)<1e-20/, 'seuil absolu revenu');
  // The two forms differ in only TWO places, and both are needed: the prepare, and the
  // singular-matrix fallback. The defect was returning the LOCAL vector — that is what
  // the previous form must keep doing, or the reproduction would return the fixed normal
  // in the middle of the defect. Everything else is the same text, hence substituting
  // the whole block.
  const repli = (texte: string) =>
    texte.split('let porte=p.adj*v;')[1].split(';')[0].replace('\n return select(', '');
  assert.equal(repli(INVERSE_TRANSPOSE_BEFORE_WGSL), 'v,p.facteur*porte,p.regulier)');
  assert.equal(repli(INVERSE_TRANSPOSE_WGSL), 'porte,p.facteur*porte,p.regulier)');
  const suite = (texte: string) => texte.slice(texte.indexOf('fn inverseTranspose3'));
  assert.equal(suite(INVERSE_TRANSPOSE_BEFORE_WGSL), suite(INVERSE_TRANSPOSE_WGSL));
});
