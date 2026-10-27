import assert from 'node:assert/strict'
import test from 'node:test'
import { Ajv } from 'ajv'
import { MESH_BUILD_RULES, PARTITION_GRID_NAME_KEY } from '../contracts/compilerAbi.ts'
import { lightmapBakeJob } from '../contracts/lightmapBakeOptions.ts'
import { resolveMeshBuild } from '../contracts/meshBuildOptions.ts'
import { resolveObjectSettings } from '../contracts/objectOptions.ts'
import { PARTITION_GRID_SETTINGS } from '../contracts/partitionOptions.ts'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'
import { job, validate } from './compilerOptionsSchema.fixture.ts'

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
    assert.throws(() => resolveMeshBuild(patch as never), words, named)
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
    assert.throws(
      () => resolveMeshBuild(patch as never),
      /allowAssemblies must be true or false/,
      named,
    )
  }
})

test('meshBuild names the displacement baked into a mesh, none by default, schema and resolver alike', () => {
  const rules = MESH_BUILD_RULES
  assert.deepEqual(
    [rules.displacementUvChannel.default, rules.displacementEdgeSplit.default],
    [0, 'seams'],
  )
  const meshBuild = {
    trimmedError: 1,
    displacementMaps: [{ texture: { index: 3 }, magnitude: 0.05, center: 0.5 }],
    displacementUvChannel: 1,
    objects: [{ match: 'Rock', displacementEdgeSplit: 'always-duplicate' as const }],
  }
  assert.equal(validate({ ...job, meshBuild }), true)
  const resolved = resolveMeshBuild(meshBuild)
  assert.deepEqual(resolved?.displacementMaps, meshBuild.displacementMaps)
  assert.equal(resolved?.objects?.[0]?.displacementEdgeSplit, 'always-duplicate')
  // A setting left out is written nowhere: a job naming none keeps its cache key.
  assert.equal(resolveMeshBuild({ keptTriangles: 1 })?.displacementMaps, undefined)
  // The resolver, not the schema, refuses a field a height map or its texture has not, and a number
  // a 32-bit float cannot hold, a magnitude in centimetres too.
  for (const [map, words] of [
    [{ texture: { index: 0 }, scale: 1 }, /no field scale/],
    [{ texture: { index: 0, texCoord: 1 } }, /texture has no field texCoord/],
    [{ texture: { index: 0 }, magnitude: 1e300 }, /magnitude must be a finite number a 32-bit/],
    [
      { texture: { index: 0 }, magnitude: 1e37 },
      /magnitude must be a finite number .* centimetres/,
    ],
    [
      { texture: { index: 0 }, center: -1e40 },
      /center must be a finite number a 32-bit float holds$/,
    ],
  ] as const)
    assert.throws(
      () => resolveMeshBuild({ displacementMaps: [map] } as never),
      words,
      JSON.stringify(map),
    )
  for (const [patch, words] of [
    [{ displacementMaps: {} }, /displacementMaps must be a list of height maps/],
    [{ displacementMaps: [{ texture: { index: -1 } }] }, /texture must be a texture info/],
    [{ displacementUvChannel: 8 }, /displacementUvChannel must be/],
    [{ displacementEdgeSplit: 'none' }, /displacementEdgeSplit must be/],
  ] as const) {
    const named = JSON.stringify(patch)
    assert.equal(validate({ ...job, meshBuild: patch }), false, named)
    assert.throws(() => resolveMeshBuild(patch as never), words, named)
  }
})

test('objectSettings names the distances an object is drawn at, for the scene and by object, the schema accepting what the resolver does', () => {
  const objectSettings = {
    drawDistance: { min: 10, max: 400 },
    objects: [
      { match: 'Grass', drawDistance: { max: 120 } },
      { match: 'Tower', drawDistance: false as const },
      { match: 'Leaf', drawDistance: { max: 30, perInstance: true } },
    ],
  }
  assert.equal(validate({ ...job, objectSettings }), true)
  // The schema refuses what is not a distance as the resolver does; true it leaves to the resolver.
  const refused = [{ min: -1 }, { max: 'far' }, { perInstance: 'yes' }]
  for (const drawDistance of refused)
    assert.equal(validate({ ...job, objectSettings: { drawDistance } }), false)
  assert.equal(resolveObjectSettings(objectSettings)?.drawDistance !== undefined, true)
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

test('meshBuild takes any finite distance field density, which the build holds to the resolution it allows', () => {
  for (const distanceFieldDensity of [0.01, 0.2, 0.5, 3]) {
    const meshBuild = { distanceFieldDensity }
    assert.equal(validate({ ...job, meshBuild }), true, String(distanceFieldDensity))
    assert.equal(resolveMeshBuild(meshBuild)?.distanceFieldDensity, distanceFieldDensity)
  }
  assert.throws(
    () => resolveMeshBuild({ distanceFieldDensity: 'dense' } as never),
    /distanceFieldDensity must be a number/,
  )
})

/** The wire form of a `lightmapBake` option: what the job puts in its `lightmapBake` field. */
const resolveLightmapBake = (option: object) =>
  lightmapBakeJob.fields({ lightmapBake: option as never }).lightmapBake

test('lightmapBake names the sky light the bake shines, none by default, schema and resolver alike', () => {
  const skyLight = {
    intensity: 2,
    color: [1, 0.9, 0.8] as const,
    lowerHemisphereColor: [0.1, 0.1, 0.1] as const,
    castShadows: false,
  }
  for (const sky of [true, false, {}, skyLight])
    assert.equal(validate({ ...job, lightmapBake: { skyLight: sky } }), true, JSON.stringify(sky))
  // A sky is written as named, one left out or `false` nowhere: a bake naming none keeps its cache key.
  assert.deepEqual(resolveLightmapBake({ skyLight: true }), { skyLight: true })
  assert.deepEqual(resolveLightmapBake({ skyLight }), { skyLight })
  assert.deepEqual(resolveLightmapBake({ skyLight: false }), {})
  assert.deepEqual(resolveLightmapBake({ giSamples: 64 }), { giSamples: 64 })
  for (const [sky, words] of [
    [{ color: [1, 2] }, /color: must be an array of 3 finite numbers/],
    [{ intensity: 'bright' }, /intensity: must be a number/],
    [{ castShadows: 1 }, /castShadows: must be true or false/],
    [{ shine: 1 }, /skyLight has no field shine/],
    [3, /skyLight must be true, false or an object of settings/],
  ] as const) {
    const named = JSON.stringify(sky)
    assert.throws(() => resolveLightmapBake({ skyLight: sky as never }), words, named)
  }
  assert.equal(validate({ ...job, lightmapBake: { skyLight: { color: [1, 2] } } }), false)
  assert.equal(validate({ ...job, lightmapBake: { skyLight: 3 } }), false)
})
