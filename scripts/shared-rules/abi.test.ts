import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { ASSET_SCOPES } from '../../packages/sdk-core/src/contracts/base.ts'
import { JOB_FIELDS, SIMPLIFICATIONS } from '../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { COMPILER_OPTIONS_SCHEMA } from '../../packages/sdk-core/src/llm/compilerOptionsSchema.ts'
import { REPOSITORY_ROOT } from '../repository-files.ts'

const ABI = 'packages/asset-compiler-rust/src/shared_math/abi.rs'

/** The quoted words of the Rust declaration that starts with `head`, in order. */
function words(rust: string, head: string) {
  const start = rust.indexOf(head)
  assert.notEqual(start, -1, head)
  const body = rust.slice(start, rust.indexOf(head.startsWith('pub mod') ? '}' : '];', start))
  return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1])
}

test('the compiler reads the job fields, scopes and simplifications the schema names', () => {
  // The compiler's job reader (`compiler_args.rs`) and check (`compiler_validate.rs`) read the
  // printed `abi.rs`; the options schema reads `compilerAbi.ts`: the two must name the same job.
  const rust = readFileSync(join(REPOSITORY_ROOT, ABI), 'utf8')
  assert.deepEqual(words(rust, 'pub mod job_field'), [...JOB_FIELDS])
  assert.deepEqual(Object.keys(COMPILER_OPTIONS_SCHEMA.properties).sort(), [...JOB_FIELDS].sort())
  assert.deepEqual(words(rust, 'pub const SCOPES'), [...ASSET_SCOPES])
  assert.deepEqual(COMPILER_OPTIONS_SCHEMA.properties.scope.enum, ASSET_SCOPES)
  assert.deepEqual(words(rust, 'pub const SIMPLIFICATIONS'), [...SIMPLIFICATIONS])
  assert.deepEqual(COMPILER_OPTIONS_SCHEMA.properties.simplification.enum, SIMPLIFICATIONS)
})
