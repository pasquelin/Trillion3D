import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Ajv } from 'ajv'
import {
  DEFAULT_DRAW_DISTANCE_MAX,
  DEFAULT_DRAW_DISTANCE_MIN,
  MESH_BUILD_RULES,
  PARTITION_GRID_NAME_KEY,
} from '../contracts/compilerAbi.ts'
import { resolveMeshBuild } from '../contracts/meshBuildOptions.ts'
import { resolveObjectSettings } from '../contracts/objectOptions.ts'
import { PARTITION_GRID_SETTINGS } from '../contracts/partitionOptions.ts'
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
    { threads: 65 },
    { triangleBudget: 0 },
    { ramBudgetMb: 63 },
    { ramBudgetMb: '128' },
    { triangleBudget: 2.5 },
    { misspelledOption: true },
  ])
    assert.equal(validate({ ...job, ...patch }), false, JSON.stringify(patch))
})

test('meshBuild names the six voxel settings, for the scene and by object, schema and resolver alike', () => {
  const rules = MESH_BUILD_RULES
  assert.deepEqual(
    [rules.voxelRays, rules.voxelLevel, rules.voxelBackUp, rules.voxelSeparable].map(
      (rule) => rule.default,
    ),
    [64, 0, 0, false],
  )
  assert.deepEqual([rules.voxelNdf.default, rules.voxelOpacity.default], [true, false])
  const voxels = {
    voxelRays: 128,
    voxelLevel: 2,
    voxelBackUp: 0.25,
    voxelSeparable: true,
    voxelNdf: false,
    voxelOpacity: true,
  }
  const meshBuild = { ...voxels, objects: [{ match: 'Tower', voxelRays: 0, voxelLevel: -1 }] }
  assert.equal(validate({ ...job, meshBuild }), true)
  const resolved = resolveMeshBuild(meshBuild)
  assert.deepEqual({ ...resolved, objects: undefined }, { ...voxels, objects: undefined })
  assert.equal(resolved?.objects?.[0]?.voxelRays, 0)
  assert.equal(resolved?.objects?.[0]?.voxelLevel, -1)
  // A count past the most a voxel casts is read as that many, by the compiler.
  assert.equal(resolveMeshBuild({ voxelRays: 5000 })?.voxelRays, 5000)
  for (const [patch, words] of [
    [{ voxelRays: -1 }, /voxelRays must be a whole number of at least 0, got -1/],
    [{ voxelRays: 1.5 }, /voxelRays must be a whole number of at least 0, got 1.5/],
    [{ voxelLevel: 0.5 }, /voxelLevel must be a whole number from -2147483648 to 2147483647/],
    [{ voxelLevel: 2 ** 31 }, /voxelLevel must be a whole number from -2147483648/],
    [{ voxelBackUp: 'far' }, /voxelBackUp must be a number/],
    [{ voxelSeparable: 1 }, /voxelSeparable must be true or false, got 1/],
    [{ voxelNdf: 'yes' }, /voxelNdf must be true or false/],
    [{ voxelOpacity: 0 }, /voxelOpacity must be true or false/],
  ] as const) {
    const named = JSON.stringify(patch)
    assert.equal(validate({ ...job, meshBuild: patch }), false, named)
    assert.throws(() => resolveMeshBuild(patch), words, named)
  }
})

test('meshBuild names whether a mesh builds its assembly, off by default, schema and resolver alike', () => {
  assert.equal(MESH_BUILD_RULES.allowAssemblies.default, false)
  const meshBuild = { allowAssemblies: true, objects: [{ match: 'Tower', allowAssemblies: false }] }
  assert.equal(validate({ ...job, meshBuild }), true)
  const resolved = resolveMeshBuild(meshBuild)
  assert.equal(resolved?.allowAssemblies, true)
  assert.equal(resolved?.objects?.[0]?.allowAssemblies, false)
  // A setting left out is written nowhere: a job naming none keeps its cache key.
  assert.equal(resolveMeshBuild({ keptTriangles: 1 })?.allowAssemblies, undefined)
  for (const patch of [{ allowAssemblies: 1 }, { allowAssemblies: 'yes' }] as const) {
    const named = JSON.stringify(patch)
    assert.equal(validate({ ...job, meshBuild: patch }), false, named)
    assert.throws(() => resolveMeshBuild(patch), /allowAssemblies must be true or false/, named)
  }
})

test('objectSettings names the distances an object is drawn at, for the scene and by object, schema and resolver alike', () => {
  assert.deepEqual([DEFAULT_DRAW_DISTANCE_MIN, DEFAULT_DRAW_DISTANCE_MAX], [0, 0])
  const objectSettings = {
    drawDistance: { min: 10, max: 400 },
    objects: [
      { match: 'Grass', drawDistance: { max: 120 } },
      { match: 'Tower', drawDistance: false },
      // No farthest distance is none, as false says: one form on the wire.
      { match: 'Moss', drawDistance: { min: 5, max: 0 } },
      { match: 'Rock', drawDistance: { min: 5 } },
    ],
  }
  assert.equal(validate({ ...job, objectSettings }), true)
  const resolved = resolveObjectSettings(objectSettings)
  assert.deepEqual(resolved?.drawDistance, { min: 10, max: 400 })
  assert.deepEqual(
    resolved?.objects?.map((rule) => rule.drawDistance),
    [{ max: 120 }, false, false, false],
  )
  for (const [patch, words] of [
    [{ drawDistance: true }, /drawDistance must be false or an object of min, max/],
    [
      { drawDistance: { min: -1 } },
      /drawDistance.min must be a finite number of at least 0, got -1/,
    ],
    [{ drawDistance: { max: 'far' } }, /drawDistance.max must be a finite number of at least 0/],
    [{ drawDistance: { near: 5 } }, /drawDistance has no field near: min, max/],
  ] as const) {
    assert.throws(() => resolveObjectSettings(patch as never), words, JSON.stringify(patch))
  }
  // The schema refuses what is not a distance as the resolver does; true it leaves to the resolver.
  assert.equal(validate({ ...job, objectSettings: { drawDistance: { min: -1 } } }), false)
  assert.equal(validate({ ...job, objectSettings: { drawDistance: { max: 'far' } } }), false)
})

test('the streaming grids a job names are advertised entry by entry, with the settings of partitionGrid', () => {
  const grids = COMPILER_OPTIONS_SCHEMA.properties.partitionGrids
  assert.deepEqual(Object.keys(grids.items?.properties ?? {}), [
    PARTITION_GRID_NAME_KEY,
    ...PARTITION_GRID_SETTINGS,
  ])
  const named = [{ cellSize: 64 }, { name: 'far', loadingRange: 512, flat: false }]
  assert.equal(validate({ ...job, partitionGrids: named }), true)
  for (const partitionGrids of [[{ name: 5 }], [{ cellSize: -1 }], 'far', {}])
    assert.equal(validate({ ...job, partitionGrids }), false, JSON.stringify(partitionGrids))
})

test('a voxel layer names the six voxel settings in its meshBuild, as a mesh does', () => {
  const build = (builder: string, meshBuild: unknown) => ({
    ...job,
    hlod: { layers: [{ name: 'far', builder, meshBuild }] },
  })
  const voxels = { voxelRays: 16, voxelLevel: 1, voxelBackUp: 0.5, voxelSeparable: true }
  assert.equal(validate(build('voxel', { ...voxels, voxelNdf: false, voxelOpacity: true })), true)
  assert.equal(validate(build('voxel', { voxelRays: -1 })), false)
  // The schema holds each as the mesh's own; the compiler refuses them in a merge layer's.
  const layer = COMPILER_OPTIONS_SCHEMA.properties.hlod.properties?.layers?.items?.properties
  const mesh = COMPILER_OPTIONS_SCHEMA.properties.meshBuild.properties
  for (const field of Object.keys({ ...voxels, voxelNdf: 0, voxelOpacity: 0 }))
    assert.deepEqual(layer?.meshBuild?.properties?.[field], mesh?.[field], field)
})

/** The images the compiler's reader in `file` (under `hlod/options/`) admits in a layer's `maps`. */
function rustMapFields(file: string) {
  const rust = readFileSync(
    new URL(`../../../asset-compiler-rust/src/hlod/options/${file}`, import.meta.url),
    'utf8',
  )
  const list = /const MAP_FIELDS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)
  assert.ok(list, file)
  return [...list[1].matchAll(/"([^"]*)"/g)].map((word) => word[1])
}

test('each builder names in its maps exactly the images its compiler reader admits', () => {
  const layerProperties =
    COMPILER_OPTIONS_SCHEMA.properties.hlod.properties?.layers?.items?.properties
  const layerMaps = layerProperties?.maps?.anyOf?.map((branch) =>
    Object.keys(branch.properties ?? {}),
  )
  assert.deepEqual(layerMaps, [rustMapFields('merging.rs'), rustMapFields('fields.rs')])
  assert.deepEqual(
    Object.keys(layerProperties?.approximation?.properties?.maps?.properties ?? {}),
    rustMapFields('approximation.rs'),
  )
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
