// A blend's own trace builds the receiver's surface info by constructor: it names every field of the struct.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { vsmFragmentTraceWgsl } from './shadowTraceWgsl.ts'

test('the blend trace constructs the receiver’s surface info with all its fields', () => {
  const code = wgslModule(
    vsmFragmentTraceWgsl(0, { view: 1, noise: 2, loadOnly: false } as never, 1),
  )
  const fields = /struct VsmSurfaceInfo\{([^}]*)\}/.exec(code)![1].split(',').filter(Boolean).length
  const built = /VsmSurfaceInfo\(([^;]*)\);/.exec(code)![1]
  // The arguments at the top level of the call: the commas outside the parentheses.
  let depth = 0,
    count = 1
  for (const c of built) {
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) count++
  }
  assert.equal(count, fields)
})
