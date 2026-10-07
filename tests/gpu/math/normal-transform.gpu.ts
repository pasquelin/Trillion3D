// What ties `xformNormal`'s f32 model to the shader the GPU runs, and what keeps its criterion
// honest.
//
// `packages/sdk-browser/src/gpu/shader/normalTransform.test.ts` checks the lighting normal's arithmetic on
// an f32 MODEL (`inverseTransposeF32.ts`), with no GPU: a regression shows in the unit tests, but a
// model is a second implementation, free to drift from the shipped text unseen. Here the engine's
// `NORMAL_TRANSFORM_WGSL` runs on Dawn on EXACTLY the same cases (`normalTransformCases.ts`), and
// its output must be the model's — and the true normal. Then the criterion (`normalVerdict`) is put
// to the test: the shader's output flipped or lost (`SUBSTITUTIONS`) must be refused on every case
// whose normal has a direction, the untouched shader accepted.
//
//   node bench/dawn/proofs.ts tests/gpu/math/normal-transform.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEG,
  DROPOUT_DEG,
  angleBetween,
  normalVerdict,
  xformNormalModel,
} from './inverseTransposeF32.ts'
import { CASES, COLLAPSED, FLATTENED, TINY_REGULAR } from './normalTransformCases.ts'
import { SUBSTITUTIONS, lightNormals } from './lightingNormalGpu.ts'

test('the shipped normal transform renders the model, the true normal, and zero for no face', async () => {
  const cases = [...CASES, ...FLATTENED, TINY_REGULAR, ...COLLAPSED]
  const { rows } = await lightNormals(cases)
  cases.forEach((lit, i) => {
    const rendered = rows[i].rendered
    if (lit.collapsed) {
      // A face with no world area has no normal: the shader returns the zero vector, exactly —
      // never a NaN, which screen derivatives would spread to the neighbouring pixels, nor the
      // local normal of a surface that does not exist. The guard's bitcast is WGSL: no model in
      // JavaScript proves it.
      assert.deepEqual(rendered, [0, 0, 0], `${lit.name}: rendered ${rendered}, not zero`)
      return
    }
    // The model, to the one gap expected: the GPU's `normalize` and the model's round their last
    // f32 place apart.
    const model = xformNormalModel(lit.world, lit.normal)
    const gap = angleBetween(rendered, model) * DEG
    assert.ok(gap < 1e-3, `${lit.name}: shader ${rendered}, model ${model}, ${gap}° apart`)
    // The right normal: the rotated surface's, on the right side, unit, at any scale — and where
    // the pose flattens the primitive, the transformed face's, worked out by hand.
    const verdict = normalVerdict(rendered, lit.truth, DROPOUT_DEG)
    assert.ok(verdict.ok, `${lit.name}: ${verdict.reason} — rendered ${rendered}`)
  })
})

test('the criterion refuses the flipped and the lost normal on every case', async () => {
  // The cases whose normal has a DIRECTION; the collapsed ones are lit too, so the text run is the
  // test above's. On a face with no area the shader already returns zero, so no substitution shows
  // there: a change that cannot be seen proves nothing, and those cases are held to their value.
  // The witness — the untouched shader passes this criterion on every case — is the test above:
  // without it, a criterion grown too strict would go unseen.
  const directed = [...CASES, ...FLATTENED, TINY_REGULAR]
  const verdicts = async (substitution: string) => {
    const { rows } = await lightNormals([...directed, ...COLLAPSED], { substitution })
    return directed.map((lit, i) => ({
      name: lit.name,
      verdict: normalVerdict(rows[i].rendered, lit.truth, DROPOUT_DEG),
    }))
  }
  // N → −N: the oriented criterion refuses every case, at about 180° from the truth.
  for (const { name, verdict } of await verdicts(SUBSTITUTIONS.flipped)) {
    assert.ok(!verdict.ok, `${name}: N → −N passes, the criterion no longer tells N from −N`)
    assert.ok(Math.abs(verdict.gapDeg - 180) < 1e-2, `${name}: N → −N at ${verdict.gapDeg}°`)
  }
  // N → 0: refused for having no direction, before any angle — never a NaN that passes, never an
  // atan2(0, 0) = 0 that calls it right.
  for (const { name, verdict } of await verdicts(SUBSTITUTIONS.lost)) {
    assert.ok(!verdict.ok, `${name}: N → 0 passes, a lost normal is no longer seen`)
    assert.ok(Number.isNaN(verdict.gapDeg), `${name}: N → 0 at ${verdict.gapDeg}°, not NaN`)
    assert.match(verdict.reason ?? '', /no direction/, `${name}: ${verdict.reason}`)
  }
})
