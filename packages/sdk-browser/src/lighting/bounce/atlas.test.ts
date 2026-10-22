// The bounce probes left their storage buffers for a float atlas, so the
// deferred lighting with bounce holds the eight storage buffers WebGPU guarantees. Defects these
// tests catch: two probe vectors written to one texel (a probe then reads its neighbour's
// coefficients), an atlas that drops the last entries or outgrows the 2D texture limit, a value
// that does not come back bit for bit, a table the host writes where the shaders do not read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS, PROBE_FLOATS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { createProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { Vec } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { GUARANTEED_SIDE } from '../../gpu/core/textureLimits.ts'
import { ATLAS_WIDTH, PROBE_TEXELS, atlasBytes, probeAtlasExtent } from './atlas.ts'
import { ATLAS_CALLS, POOL_ROW_PROBES, simulatedAtlas } from './atlas.fixture.ts'
import { ensureBounceFits } from './limits.ts'
import { createBounceSchedule } from './schedule.ts'
import { BOUNCE_TABLE_SHADER } from './probes/tableWgsl.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { BOUNCE_PROBE_SHADER } from './probes/probeWgsl.ts'
import { BOUNCE_CENSUS_SHADER, CENSUS, CENSUS_WORDS } from './probes/censusWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { adaptiveSamples, geometryOfTile, screenProbeGeometry } from './screen/screenProbeLayout.ts'

type Probe = {
  poolProbe: (slot: number) => Vec
  probeAt: (probe: Vec, k: number) => Vec
  probeStore: (probe: Vec, k: number, value: Vec) => void
  tableEntry: (entry: number) => number
}

const FUNCTIONS = ['poolProbe', 'probeAt', 'probeStore', 'probeTexel', 'tableEntry']

test('every probe vector has a texel of its own, read back bit for bit where it was written', () => {
  const pool = 3 * POOL_ROW_PROBES + 5
  // Every texel unwritten (NaN) until a vector is stored there.
  const probes = simulatedAtlas(probeAtlasExtent(pool, 64), () => NaN)
  const run = shaderRun<Probe>(BOUNCE_PROBE_SHADER, FUNCTIONS, {
    ...ATLAS_CALLS,
    probes,
    probesOut: probes,
  })
  const vectors: [Vec, number][] = []
  for (let slot = 0; slot < pool; slot++)
    for (let k = 0; k < PROBE_TEXELS; k++) vectors.push([run.poolProbe(slot), k])
  const value = (i: number) => [i, Math.fround(i / 3), -i, Math.fround(Math.PI * i)]
  vectors.forEach(([probe, k], i) => run.probeStore(probe, k, value(i)))
  const written = probes.texels.filter((texel) => !Number.isNaN(texel[0])).length
  assert.equal(written, pool * PROBE_TEXELS, 'no two vectors share a texel')
  vectors.forEach(([probe, k], i) => assert.deepEqual(run.probeAt(probe, k), value(i), `${i}`))
  // The pool lives in its own layer: the table's is untouched.
  assert.ok(
    vectors.every(([probe]) => probe[2] === 0),
    'the pool is the first layer',
  )
})

test('the table the host writes is the one the shaders read: a cell names the probe it holds', () => {
  const cascades = { ...createBounceCascades([0, 0, 0, 10, 10, 10]), probes: 64 }
  cascades.follow([5, 5, 5])
  const pool = createProbePool(cascades)
  const schedule = createBounceSchedule(pool)
  const extent = probeAtlasExtent(pool.capacity, cascades.levels.length * cascades.cells)
  const atlas = simulatedAtlas(extent, () => 0)
  const run = shaderRun<Probe>(BOUNCE_PROBE_SHADER, FUNCTIONS, { ...ATLAS_CALLS, probes: atlas })
  // Cells of every level, several to a texel and several texels to a row of the table, read and traced.
  const read: { level: number; cell: number[] }[] = []
  for (let level = 0; level < cascades.levels.length; level++) {
    const spacing = cascades.levels[level].spacing
    const at = [5, 5, 5].map((v) => Math.floor(v / spacing))
    for (let d = -4; d < 6; d += 3)
      for (const dz of [0, 1, 7]) {
        const cell = [at[0] + d, at[1], at[2] + dz]
        pool.mark(level, cell[0], cell[1], cell[2], 1)
        read.push({ level, cell })
      }
  }
  schedule.plan(2, [5, 5, 5], 64)
  assert.ok(schedule.texels > 0)
  // The kernel that writes the table (`writeTable`), a thread a record, as the pass dispatches it:
  // into the probes' atlas and its snapshot, the two alike.
  const snapshot = simulatedAtlas(extent, () => 0)
  const { writeTable } = shaderRun<{ writeTable: (id: number[]) => void }>(
    BOUNCE_TABLE_SHADER,
    ['writeTable'],
    { ...ATLAS_CALLS, tableRecords: schedule.records, probesOut: atlas, snapshotOut: snapshot },
  )
  for (let id = 0; id < ceilDiv(schedule.texels, WORKGROUP_THREADS) * WORKGROUP_THREADS; id++)
    writeTable([id, 0, 0])
  assert.deepEqual(snapshot.texels, atlas.texels, 'the snapshot holds the table as the probes do')
  assert.ok(atlas.texels.some((texel) => texel.some((lane) => lane !== 0)))
  const size = cascades.size
  const wrap = (v: number) => ((v % size) + size) % size
  const slots = new Set<number>()
  for (const { level, cell } of read) {
    const entry = ((level * size + wrap(cell[2])) * size + wrap(cell[1])) * size + wrap(cell[0])
    const slot = run.tableEntry(entry)
    assert.ok(slot >= 1 && slot <= pool.capacity, `level ${level} cell ${cell}: slot ${slot}`)
    slots.add(slot)
  }
  assert.equal(slots.size, read.length, 'every cell names a probe of its own')
  // A cell nobody read names none.
  assert.equal(run.tableEntry(7), 0)
})

test('the probe atlas holds the pool in one layer and the table that names it in the next', () => {
  const entries = BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3
  const extent = probeAtlasExtent(BOUNCE_SETTINGS.probePool, entries)
  assert.equal(extent[0], ATLAS_WIDTH)
  assert.equal(extent[2], 2, 'the pool, the table')
  // The pool fills a layer's rows with the probes of the pool, `PROBE_TEXELS` texels each.
  assert.ok(
    extent[0] * extent[1] >= BOUNCE_SETTINGS.probePool * PROBE_TEXELS,
    'the pool fits a layer',
  )
  // The table: four entries a texel, every cell of every level, in the same layer size.
  assert.ok(extent[0] * extent[1] * 4 >= entries, 'the table fits a layer')
  // Both layers, at a probe's floats a probe and a table texel's four floats a texel.
  assert.equal(atlasBytes(extent), extent[0] * extent[1] * extent[2] * 16)
  assert.ok(atlasBytes(extent) >= BOUNCE_SETTINGS.probePool * PROBE_FLOATS * 4)
  assert.ok(extent[0] <= GUARANTEED_SIDE && extent[1] <= GUARANTEED_SIDE)
  // The default pool: 128 rows of 128 probes, 2.9 MiB of probes beside 2.9 MiB of layer for the table.
  assert.deepEqual(extent, [128 * PROBE_TEXELS, 128, 2])
})

// Behaviour: the probes' atlas is as wide as the device grants; past its side it is refused.
test('a probe atlas within the 2D limit is made, and a larger one is refused', () => {
  const device = (maxTextureDimension2D: number) =>
    fakeDevice({ limits: { maxTextureDimension2D, maxTextureArrayLayers: 256 } }).device
  const wide = [GUARANTEED_SIDE + 1, 1, 1]
  assert.throws(
    () => ensureBounceFits(device(GUARANTEED_SIDE), wide, 16),
    /bounce atlas "probes" needs .* over this device's maxTextureDimension2D of 8192/,
  )
  assert.doesNotThrow(() => ensureBounceFits(device(2 * GUARANTEED_SIDE), wide, 16))
  // Another storage buffer of the passes — the table's records, the marks' bitmap — is held to the limit too.
  const small = fakeDevice({
    limits: { maxStorageBufferBindingSize: 2 ** 27, maxBufferSize: 2 ** 28 },
  }).device
  assert.throws(
    () => ensureBounceFits(small, [1, 1, 1], 16, [{ name: 'marks', bytes: 2 ** 28 }]),
    /bounce binding "marks" needs 268435456 bytes, over this device's maxStorageBufferBindingSize/,
  )
})

test('the census counts the probes that hold light and the entries of the table that name one', () => {
  const pool = 8,
    entries = 64
  const atlas = simulatedAtlas(probeAtlasExtent(pool, entries), () => 0)
  const store = (slot: number, k: number, value: number[]) =>
    ATLAS_CALLS.textureStore(atlas, [(slot % POOL_ROW_PROBES) * PROBE_TEXELS + k, 0], 0, value)
  // Slot 0 holds light, 1 a probe that sees none, 2 is buried, 3 never written (state zero).
  store(0, 0, [1, 0, 0, 1])
  store(0, 2, [0, 0, 0, 1])
  store(1, 2, [0, 0, 0, 1])
  store(2, 2, [0, 0, 0, -1])
  // The table: two entries in its first texel, four in the fourth; a texel past the last entry is not read.
  const table = (texel: number, lanes: number[]) =>
    ATLAS_CALLS.textureStore(atlas, [texel, 0], 1, lanes)
  table(0, [3, 0, 5, 0])
  table(3, [1, 1, 1, 1])
  table(entries / 4, [9, 9, 9, 9])
  const census = new Uint32Array(CENSUS_WORDS)
  const { countThread, flushTally } = shaderRun<{
    countThread: (id: number) => void
    flushTally: (lane: number) => void
  }>(BOUNCE_CENSUS_SHADER, ['countThread', 'flushTally', 'poolProbe', 'probeAt', 'probeTexel'], {
    ...ATLAS_CALLS,
    probes: atlas,
    census,
    tally: new Uint32Array(CENSUS_WORDS),
    workgroupBarrier: () => {},
    bounce: { counts: [48, 1, entries, pool] },
  })
  // One workgroup: its threads count in the tally, then each lane adds a word of it to the census.
  for (let id = 0; id < pool + entries / 4 + 8; id++) countThread(id)
  for (let lane = 0; lane < WORKGROUP_THREADS; lane++) flushTally(lane)
  assert.equal(census[CENSUS.fieldLit], 1, 'a probe that holds light')
  assert.equal(census[CENSUS.fieldDark], 1, 'one that holds none')
  assert.equal(census[CENSUS.fieldBuried], 1, 'one buried')
  assert.equal(census[CENSUS.fieldPublished], 6, 'the entries that name a probe')
})

test('the screen probes cut the image into tiles, an atlas row of adaptive probes below each fraction of the rows', () => {
  const ultra = screenProbeGeometry(1920, 1080, screenProbeSettings())
  assert.deepEqual(
    [ultra.tile, ultra.tilesX, ultra.tilesY, ultra.rows, ultra.uniform, ultra.maxAdaptive],
    [16, 120, 68, 102, 8160, 4080],
  )
  assert.deepEqual([ultra.samplesX, ultra.samplesY, ultra.tracing], [4, 2, 8])
  const bare = screenProbeGeometry(
    1920,
    1080,
    screenProbeSettings({ screenProbeAdaptiveFraction: 0 }),
  )
  assert.deepEqual([bare.rows, bare.maxAdaptive], [68, 0])
  const small = screenProbeGeometry(1, 1, screenProbeSettings())
  assert.deepEqual([small.tilesX, small.tilesY, small.uniform], [1, 1, 1])
  assert.deepEqual([16, 8, 4].map(adaptiveSamples), [
    [4, 4],
    [4, 2],
    [2, 2],
  ])
  // An image drawn smaller in the targets of a larger one keeps the larger one's tile: its probes lie in the atlas they were made for.
  const drawn = geometryOfTile(1280, 720, ultra.tile, screenProbeSettings())
  assert.deepEqual([drawn.tile, drawn.tilesX, drawn.rows], [16, 80, 67])
  assert.ok(drawn.tilesX <= ultra.tilesX && drawn.rows <= ultra.rows)
  // A device that holds textures to 8192 texels: the cinematic level at 3840 pixels (7680 texels wide) fits, at 5120 pixels
  // (10240) the tile doubles until the atlas does.
  const cinematic = screenProbeSettings({ screenProbes: 'cinematic' })
  assert.equal(screenProbeGeometry(3840, 2160, cinematic, 8192).tile, 8)
  const wide = screenProbeGeometry(5120, 2880, cinematic, 8192)
  assert.deepEqual([wide.tile, wide.tilesX * 16 <= 8192, wide.rows * 16 <= 8192], [16, true, true])
})

test('the kernels are keyed by what their code depends on: a switch of the occlusion or the scene recompiles those alone', () => {
  const keys = (options: ScreenProbeOptions) =>
    Object.fromEntries(
      Object.entries(screenProbeSources(kernelShapeOf(screenProbeSettings(options)))).map(
        ([name, source]) => [name, source.key],
      ),
    )
  const ultra = keys({})
  const changed = (other: Record<string, string>) =>
    Object.keys({ ...ultra, ...other }).filter((name) => ultra[name] !== other[name])
  assert.deepEqual(
    changed(keys({ screenProbeSceneTraces: false })),
    ['traceScene'],
    'the scene stage alone',
  )
  assert.deepEqual(
    changed(keys({ screenProbes: 'high' })).sort(),
    [
      'composite',
      'convert',
      'occlusion',
      'place',
      'rays',
      'scatter',
      'screenData',
      'spatial',
      'temporal',
      'traceField',
      'traceScene',
      'traceScreen',
    ].sort(),
    'a level that changes the samples, the rays and the occlusion',
  )
  assert.deepEqual(
    changed(keys({ screenProbeSpatialFilterPasses: 1, screenProbeQuality: 1 })),
    [],
    'the passes are a count',
  )
})
