// Defect 6 (`inverseTranspose3` in the DAG selection kernel, `gpu/dag/shader/shader.ts`): an absolute
// `abs(det)<1e-20` on the raw determinant returned the LOCAL axis untransformed as soon as a small
// uniform scale (det = ±s³ < 1e-20, s ≲ 2.15e-7) made the determinant tiny. The conformity test
// (defect 1) being scale-free, a tiny rotation was conformal on both sides and only the GPU took the
// shortcut: it set the unrotated axis against the camera and culled faces that still faced it.
//
// The kernel runs on Dawn (`../dag/selectionKernel.ts`) as shipped and with the defect,
// rebuilt by `substitutionBefore.ts`. A cull is judged against what the engine DRAWS
// (`engineDraws.ts`), never against the raw orientation, which ignores the face the engine swaps
// under a mirror: the two populations the raw count mixes are kept apart.
//
//   node bench/dawn/proofs.ts tests/gpu/math/inverse-transpose-small-scale.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts'
import { runSelectionKernel } from '../dag/selectionKernel.ts'
import {
  VIEWPORT,
  coneDecision,
  cpuDecision,
  inFrustum,
  packCases,
  rawOrientation,
  view,
  type Case,
} from './inverseTransposeCases.ts'
import { ALL_CASES, OUTSIDE_BAND, turned } from './inverseTransposeSample.ts'
import { classifyCulls, engineDraws } from './engineDraws.ts'
import { inverseTransposeBeforeIn } from './substitutionBefore.ts'

/** For each case, whether each kernel of `shaders` culls its page — the cases packed once. */
async function kernelCulls(cases: Case[], ...shaders: string[]) {
  const uniforms = cameraSelectionUniforms(view, 0, VIEWPORT)
  const packed = packCases(cases)
  return Promise.all(
    shaders.map(async (shader) => {
      const { readings } = await runSelectionKernel([{ name: 'cases', packed, uniforms }], shader)
      const kept = new Set(readings[0].pages)
      return cases.map((_, i) => !kept.has(i))
    }),
  )
}

test('the kernel keeps a half-turned cluster at every uniform scale, and culls it turned away', async () => {
  const cases = [1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16].flatMap((s) =>
    [180, 0].map((angleDeg) => turned(s, 'uniform', angleDeg)),
  )
  const [culls] = await kernelCulls(cases, DAG_SELECTION_SHADER)
  cases.forEach((lit, i) => {
    const name = `s=${lit.s} rotation=${lit.angleDeg}`
    assert.equal(
      culls[i],
      coneDecision(lit).coneCulls,
      `${name}: the kernel decides as the CPU's cone`,
    )
    assert.equal(
      culls[i],
      !rawOrientation(lit).frontVisible,
      `${name}: culled exactly when turned away`,
    )
  })
  assert.equal(cases.filter((lit) => rawOrientation(lit).frontVisible).length, cases.length / 2)
})

test('before the fix the kernel culled clusters the engine draws; the shipped kernel culls none', async () => {
  const before = inverseTransposeBeforeIn(DAG_SELECTION_SHADER, 'DAG_SELECTION_SHADER')
  const raw = ALL_CASES.map(rawOrientation)
  const [draws, [cullsBefore, cullsAfter]] = await Promise.all([
    engineDraws(ALL_CASES),
    kernelCulls(ALL_CASES, before, DAG_SELECTION_SHADER),
  ])
  const { index, population } = classifyCulls(raw, draws)
  const [then, now] = [population(cullsBefore), population(cullsAfter)]

  // The counter-example, the first witness (`inverseTransposeSample.ts`): the defect, then its end.
  const counter = ALL_CASES[0]
  assert.ok(inFrustum(counter), 'the counter-example is in view')
  assert.ok(
    raw[0].triangles.every((t) => t.facing > 0.5 && t.areaPixels > 100),
    'both its triangles clearly face the camera',
  )
  assert.ok(draws.fragments[0] > 0, 'the engine itself draws the counter-example')
  assert.equal(cpuDecision(counter).conformal, true, 'the CPU judges its transform conformal')
  assert.equal(cpuDecision(counter).culls, false, 'the CPU cut keeps both triangles')
  assert.equal(cullsBefore[0], true, 'before: the kernel culled the visible cluster')
  assert.equal(cullsAfter[0], false, 'shipped: the kernel keeps it')

  // The populations, each held apart.
  assert.ok(then.wrong > 0, 'the defect shows against what the engine draws, not only raw')
  assert.equal(now.wrong, 0, `${now.wrong} clusters the engine draws are still culled`)
  assert.equal(now.raw, now.rawUndrawn, 'every cull left is a face the engine does not draw')
  for (const [name, counts] of Object.entries({ then, now })) {
    assert.equal(counts.raw, counts.rawDrawn + counts.rawUndrawn, `${name}: raw does not partition`)
    assert.equal(
      counts.wrong,
      counts.rawDrawn + counts.missedByRaw,
      `${name}: wrong does not partition`,
    )
  }
  assert.ok(then.rawUndrawn > 0 && then.missedByRaw > 0, 'the old count was wrong both ways')

  // What the fix must not change.
  const changed = index.filter((i) => cullsBefore[i] !== cullsAfter[i])
  assert.deepEqual(
    changed.filter((i) => OUTSIDE_BAND.includes(ALL_CASES[i].s)),
    [],
    'outside the threshold band (det ≥ 1e-20) no selection changes',
  )
  assert.equal(cullsAfter[1], false, 'large scale: det ≫ 1e-20, the kernel keeps it')
  assert.equal(raw[2].frontVisible, false, 'no rotation: its faces turn away')
  assert.equal(draws.fragments[2], 0, 'no rotation: the engine draws none of it')
  assert.equal(cullsAfter[2], true, 'no rotation: the right cull stays')
  assert.equal(cullsAfter[3], false, 'not conformal: never culled, whatever the rotation')
})
