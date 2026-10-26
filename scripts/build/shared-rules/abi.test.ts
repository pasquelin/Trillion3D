import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { ASSET_SCOPES } from '../../../packages/sdk-core/src/contracts/base.ts'
import {
  HLOD_FIELD,
  JOB_FIELDS,
  MATERIALS_FIELD,
  MESH_BUILD_FIELD,
  OBJECT_SETTINGS_FIELD,
  PARTITION_GRID_FIELD,
  PARTITION_GRIDS_FIELD,
  RESPONSIVE_FIELD,
  SIMPLIFICATIONS,
  TEMPORAL_AA_FIELD,
  VOXELIZE_FIELD,
} from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { PARTITION_SCHEME_FIELD } from '../../../packages/sdk-core/src/contracts/partitionOptions.ts'
import { LIGHTMAP_BAKE_FIELD } from '../../../packages/sdk-core/src/contracts/lightmapBakeAbi.ts'
import {
  DISPLACEMENT_MAP_KEYS,
  DISPLACEMENT_TEXTURE_KEYS,
} from '../../../packages/sdk-core/src/contracts/displacementBakeAbi.ts'
import { COMPILER_OPTIONS_SCHEMA } from '../../../packages/sdk-core/src/llm/compilerOptionsSchema.ts'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import { REPOSITORY_ROOT } from '../../git/repository-files.ts'
import { compilerAbiRust } from './abi.ts'
import { displacementBakeAbiRust } from './displacementBake.ts'

const ABI = 'packages/asset-compiler-rust/src/shared_math/abi.rs'

/** The quoted words of the Rust declaration that starts with `head`, in order. */
function words(rust: string, head: string) {
  const start = rust.indexOf(head)
  assert.notEqual(start, -1, head)
  const body = rust.slice(start, rust.indexOf(head.startsWith('pub mod') ? '}' : '];', start))
  return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1])
}

test('the compiler reads the job fields, scopes and simplifications the schema names', () => {
  // The compiler's job reader (`compiler/args.rs`) and check (`compiler/validate.rs`) read the
  // printed `abi.rs`; the options schema reads `compilerAbi.ts`: the two must name the same job.
  const rust = readFileSync(join(REPOSITORY_ROOT, ABI), 'utf8')
  assert.deepEqual(words(rust, 'pub mod job_field'), [...JOB_FIELDS])
  assert.deepEqual(
    Object.keys(COMPILER_OPTIONS_SCHEMA.properties).sort(),
    [
      ...JOB_FIELDS,
      HLOD_FIELD,
      TEMPORAL_AA_FIELD,
      RESPONSIVE_FIELD,
      MATERIALS_FIELD,
      VOXELIZE_FIELD,
      PARTITION_SCHEME_FIELD,
      PARTITION_GRID_FIELD,
      PARTITION_GRIDS_FIELD,
      MESH_BUILD_FIELD,
      OBJECT_SETTINGS_FIELD,
      LIGHTMAP_BAKE_FIELD,
    ].sort(),
  )
  assert.deepEqual(words(rust, 'pub const SCOPES'), [...ASSET_SCOPES])
  assert.deepEqual(COMPILER_OPTIONS_SCHEMA.properties.scope.enum, ASSET_SCOPES)
  assert.deepEqual(words(rust, 'pub const SIMPLIFICATIONS'), [...SIMPLIFICATIONS])
  assert.deepEqual(COMPILER_OPTIONS_SCHEMA.properties.simplification.enum, SIMPLIFICATIONS)
})

test('the baked spots read the engine’s own cone limit and gap, printed into the compiler’s Rust', () => {
  // The compiler's lights (`shared_math.rs`, `spot_cosines`) clamp a spot's cones as the runtime does
  // (`spotAnglesOf`): the two numbers are the contract's, never typed again in Rust.
  const printed = compilerAbiRust()
  assert.ok(printed.includes(`pub const SPOT_CONE_LIMIT: f64 = ${LIGHT_SETTINGS.spotConeLimit};`))
  assert.ok(printed.includes(`pub const SPOT_CONE_GAP: f64 = ${LIGHT_SETTINGS.spotConeGap};`))
})

test('the keys of a height map and of its texture are the contract’s, printed into the compiler’s Rust', () => {
  // The Rust reader refuses a key of a map or of its texture that these lists lack
  // (`mesh_build/displacement.rs`), as the TypeScript resolver does (`displacementMapsRefusal`).
  const printed = displacementBakeAbiRust()
  const file = 'packages/asset-compiler-rust/src/displace/abi.rs'
  const written = readFileSync(join(REPOSITORY_ROOT, file), 'utf8')
  for (const [name, keys] of [
    ['DISPLACEMENT_MAP_KEYS', DISPLACEMENT_MAP_KEYS],
    ['DISPLACEMENT_TEXTURE_KEYS', DISPLACEMENT_TEXTURE_KEYS],
  ] as const)
    for (const rust of [printed, written])
      assert.deepEqual(words(rust, `pub const ${name}`), [...keys], name)
})
