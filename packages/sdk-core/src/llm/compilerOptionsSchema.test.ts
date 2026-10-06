import assert from 'node:assert/strict'
import test from 'node:test'
import { Ajv } from 'ajv'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'

const validate = new Ajv().compile(COMPILER_OPTIONS_SCHEMA)
const job = { source: 'model.glb', cache: 'cache/model', resourceBaseUrl: '/assets/model/' }

test('compiler arguments accept a real job and refuse missing, mistyped or unknown fields', () => {
  assert.equal(
    validate({
      ...job,
      scope: 'full',
      triangleBudget: 1200,
      threads: 3,
      ramBudgetMb: 128,
      simplification: 'qem-endpoints',
    }),
    true,
  )
  for (const field of ['source', 'cache', 'resourceBaseUrl']) {
    const absent: Record<string, unknown> = { ...job }
    delete absent[field]
    assert.equal(validate(absent), false, `missing ${field}`)
    assert.equal(validate({ ...job, [field]: 42 }), false, `mistyped ${field}`)
  }
  for (const patch of [
    { scope: 'typo' },
    { scope: 1 },
    { simplification: 'typo' },
    { simplification: false },
    { threads: 0 },
    { threads: 1.5 },
    { ramBudgetMb: 63 },
    { ramBudgetMb: '128' },
    { triangleBudget: 2.5 },
    { misspelledOption: true },
  ])
    assert.equal(validate({ ...job, ...patch }), false, JSON.stringify(patch))
})

test('a job naming only its paths is completed into a job the same schema accepts', () => {
  const request: Record<string, unknown> = { ...job }
  assert.equal(new Ajv({ useDefaults: true }).compile(COMPILER_OPTIONS_SCHEMA)(request), true)
  const defaulted = Object.entries(COMPILER_OPTIONS_SCHEMA.properties).filter(
    ([, property]) => property.default !== undefined,
  )
  assert.ok(defaulted.length > 0)
  for (const [key] of defaulted) {
    assert.notEqual(request[key], undefined, key)
    // Each default, alone, passes the checks of its own field.
    assert.equal(validate({ ...job, [key]: request[key] }), true, key)
  }
})
