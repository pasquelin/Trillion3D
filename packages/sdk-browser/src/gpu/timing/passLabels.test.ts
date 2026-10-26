// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and the profile files a span by that label alone (`../../diagnostic/stage/passTable.ts`).
// Every label a pass begins with is a constant of a label module, and every one of them is declared
// once, with its stage and block, in that module (`../../diagnostic/stage/passDeclaration.ts`); the virtual
// shadow maps' passes, whose labels carry their chunk, set or kernel, are one declared family.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import { passRowOf } from '../../diagnostic/stage/passTable.ts'
import * as engineLabels from '../../diagnostic/stage/passLabels.ts'
import * as mipsLabels from '../../materials/texture/mipsPass.ts'
import * as deformationLabels from '../../deformation/pass.ts'

const { ENGINE_PASSES, VSM_PASS_PREFIX } = engineLabels

/** The labels a label module gives the passes to begin with: each of its `…_PASS` constants. */
const labelsOf = (labelModule: object) =>
  Object.entries(labelModule).flatMap(([name, value]) =>
    name.endsWith('_PASS') && typeof value === 'string' ? [value] : [],
  )

/** The labels the engine's passes begin with, as the label modules give them. */
const BEGUN = [...labelsOf(engineLabels), ...labelsOf(deformationLabels), ...labelsOf(mipsLabels)]

/** The declarations, as each label module files its own passes: the table reads these. */
const DECLARED = [
  ...ENGINE_PASSES,
  ...mipsLabels.MIPS_PASSES,
  ...deformationLabels.DEFORMATION_PASSES,
]

test('the declarations and the labels the passes begin with are one to one', () => {
  const declared = DECLARED.map((pass) => pass.label).sort()
  assert.equal(new Set(BEGUN).size, BEGUN.length, 'no two passes share a label')
  assert.deepEqual(declared, [...BEGUN].sort(), 'each label is declared once, and nothing else')
  for (const label of BEGUN) assert.ok(passRowOf(label), `${label}: the table files its pass`)
})

test('every declaration files its pass on a stage the engine profiles, at its index', () => {
  for (const { label, stage, block } of DECLARED)
    assert.deepEqual(passRowOf(label), { stage, at: WEBGPU_STAGES.indexOf(stage), block }, label)
  assert.ok(DECLARED.every(({ stage }) => WEBGPU_STAGES.includes(stage)))
})

test('the virtual shadow maps are one declared family, which no declared label repeats', () => {
  assert.equal(passRowOf(`${VSM_PASS_PREFIX}render.cull 3`)?.stage, 'shadows')
  assert.equal(passRowOf(`${VSM_PASS_PREFIX}render.cull 3`)?.block, 'other')
  assert.deepEqual(
    DECLARED.filter(({ label }) => label.startsWith(VSM_PASS_PREFIX)),
    [],
  )
  assert.deepEqual(
    DECLARED.filter(({ stage }) => stage === 'shadows'),
    [],
    'the family is the one rule: no declared pass joins the Shadows stage',
  )
})

test('a label no declaration names has no row', () => {
  assert.equal(passRowOf('beginComputePass'), undefined)
  assert.equal(passRowOf('Trillion3D pass invented tomorrow'), undefined)
})
