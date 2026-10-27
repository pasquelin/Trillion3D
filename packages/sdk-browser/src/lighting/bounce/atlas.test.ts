// The bounce cell table is one float texture the pool writes as a storage texture and the passes that look for the probe of a cell read
// with `textureLoad`, so the lit passes hold the storage buffers WebGPU guarantees. Defects these tests catch: an atlas that drops the
// last entries or outgrows the 2D texture limit, a table the pool writes where the shaders do not read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { GUARANTEED_SIDE } from '../../gpu/core/textureLimits.ts'
import { TABLE_WIDTH, tableBytes, tableExtent } from './atlas.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { ATLAS_CALLS, simulatedAtlas } from './atlas.fixture.ts'
import { ensureBounceFits } from './limits.ts'
import { simulatedPool } from './pool/pool.fixture.ts'
import { kernelShapeOf, raysKey, screenProbeSources, shapeKey } from './screen/kernels.ts'
import { ensureScreenProbeView } from './screen/view.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import {
  adaptiveSamples,
  atlasFits,
  geometryOfTile,
  screenProbeGeometry,
} from './screen/screenProbeLayout.ts'

test('the table the pool writes is the one the shaders read: a cell names the probe it holds', () => {
  const cascades = { ...createBounceCascades([0, 0, 0, 10, 10, 10]), probes: 64 }
  cascades.follow([5, 5, 5])
  const atlas = simulatedAtlas(tableExtent(cascades.levels.length * cascades.cells), () => 0)
  const pool = simulatedPool(cascades, cascades.probes, atlas)
  const run = shaderRun<{ tableEntry: (entry: number) => number }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1)),
    ['tableEntry'],
    { ...ATLAS_CALLS, cellTable: atlas },
  )
  // Cells of every level, several to a texel and several texels to a row of the table, read and traced.
  const read: { level: number; cell: number[] }[] = []
  for (let level = 0; level < cascades.levels.length; level++) {
    const spacing = cascades.levels[level].spacing
    const at = [5, 5, 5].map((v) => Math.floor(v / spacing))
    for (let d = -4; d < 6; d += 3)
      for (const dz of [0, 1, 7]) {
        const cell = [at[0] + d, at[1], at[2] + dz]
        pool.mark(level, cell[0], cell[1], cell[2])
        read.push({ level, cell })
      }
  }
  // The pass: the cells marked take a probe each, the probes never traced are queued and published to the table.
  const queued = pool.image({ rank: 2, eye: [5, 5, 5], budget: 64 })
  assert.equal(queued.length, read.length)
  assert.ok(atlas.texels.some((texel) => texel.some((lane) => lane !== 0)))
  const size = cascades.size
  const wrap = (v: number) => ((v % size) + size) % size
  const slots = new Set<number>()
  for (const { level, cell } of read) {
    const entry = ((level * size + wrap(cell[2])) * size + wrap(cell[1])) * size + wrap(cell[0])
    const slot = run.tableEntry(entry)
    assert.ok(slot >= 1 && slot <= cascades.probes, `level ${level} cell ${cell}: slot ${slot}`)
    assert.ok(
      queued.some(
        (entry) =>
          entry.slot === slot - 1 && entry.level === level && entry.cell.join() === cell.join(),
      ),
      'and the probe queued for the cell is the one it names',
    )
    slots.add(slot)
  }
  assert.equal(slots.size, read.length, 'every cell names a probe of its own')
  // A cell nobody read names none.
  assert.equal(run.tableEntry(7), 0)
})

test('the cell table holds an entry for every cell of every level, in one layer', () => {
  const entries = BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3
  const extent = tableExtent(entries)
  assert.equal(extent[0], TABLE_WIDTH)
  assert.equal(extent[2], 1, 'one layer')
  // Four entries a texel, every cell of every level.
  assert.ok(extent[0] * extent[1] * 4 >= entries, 'the table fits')
  assert.ok((extent[1] - 1) * extent[0] * 4 < entries, 'and no row more')
  assert.equal(tableBytes(extent), extent[0] * extent[1] * 16)
  assert.ok(extent[0] <= GUARANTEED_SIDE && extent[1] <= GUARANTEED_SIDE)
  // The default levels: 4 levels of 48³ cells, 108 rows of 1024 texels, 1.7 MiB.
  assert.deepEqual(extent, [1024, 108, 1])
})

// Behaviour: the table is as wide as the device grants; past its side it is refused.
test('a cell table within the 2D limit is made, and a larger one is refused', () => {
  const device = (maxTextureDimension2D: number) =>
    fakeDevice({ limits: { maxTextureDimension2D, maxTextureArrayLayers: 256 } }).device
  const wide = [GUARANTEED_SIDE + 1, 1, 1]
  assert.throws(
    () => ensureBounceFits(device(GUARANTEED_SIDE), wide, 16),
    /bounce atlas "table" needs .* over this device's maxTextureDimension2D of 8192/,
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
  // A device that holds textures to 8192 texels: the gathered radiance holds its border (18 texels a probe at the cinematic level), so that at 3840 pixels the tile of 8 (8640 texels wide)
  // doubles, and at 5120 pixels too, until the atlas fits.
  const cinematic = screenProbeSettings({ screenProbes: 'cinematic' })
  assert.equal(screenProbeGeometry(3840, 2160, cinematic, 8192).tile, 16)
  const wide = screenProbeGeometry(5120, 2880, cinematic, 8192)
  assert.deepEqual([wide.tile, wide.tilesX * 18 <= 8192, wide.rows * 18 <= 8192], [16, true, true])
  // Levels of detail whose border alone fills a texture: the tile doubles to its largest and the atlas still does not fit, which the view refuses.
  const deep = screenProbeSettings({ screenProbeGatherNumMips: 12 })
  const crowded = screenProbeGeometry(1920, 1080, deep, 8192)
  assert.deepEqual([crowded.tile, atlasFits(crowded, deep, 8192)], [64, false])
  assert.ok(atlasFits(wide, cinematic, 8192))
})

test('the key of the whole shape tells the settings that share the kernels from those that do not, and names the rays of the traced stage', () => {
  const key = (options: ScreenProbeOptions) => shapeKey(kernelShapeOf(screenProbeSettings(options)))
  assert.equal(
    key({ screenProbeSpatialFilterPasses: 1 }),
    key({}),
    'a count the code does not hold',
  )
  for (const other of [
    { screenProbeGatherNumMips: 2 },
    { screenProbeExtraAmbientOcclusion: true },
    { screenProbeTemporalFilterProbes: true },
    { screenProbes: 'high' as const },
  ])
    assert.notEqual(key(other), key({}), JSON.stringify(other))
  assert.equal(raysKey({ side: 8, samples: [4, 2], heightFog: false }), '8x4x2|false')
  assert.notEqual(
    raysKey({ side: 8, samples: [4, 2], heightFog: true }),
    raysKey({ side: 8, samples: [4, 2], heightFog: false }),
    'the fog on the rays makes another traced kernel',
  )
})

test('a view is remade for what its resources read and left be for what only the kernels read', () => {
  const { device } = fakeDevice()
  const settings = screenProbeSettings({})
  /** Whether a view made for `settings` is the one held for `next`. */
  const held = (next: typeof settings) => {
    const view = ensureScreenProbeView(undefined, device, [64, 64], settings).view!
    return ensureScreenProbeView(view, device, [64, 64], next).view === view
  }
  assert.ok(held({ ...settings }), 'the same settings, a new object')
  // The pyramid and the power of the occlusion are in the kernels' key (`shapeKey`) alone.
  const kernelsOnly = {
    ...settings,
    occlusionPyramid: !settings.occlusionPyramid,
    occlusionForegroundPower: settings.occlusionForegroundPower + 1,
  }
  assert.notEqual(shapeKey(kernelShapeOf(kernelsOnly)), shapeKey(kernelShapeOf(settings)))
  assert.ok(held(kernelsOnly))
  for (const other of [
    { screenProbeGatherNumMips: 2 },
    { screenProbeExtraAmbientOcclusion: true },
    { screenProbeTemporalFilterProbes: true },
    { screenProbeBentNormal: false },
    { screenProbeAdaptiveFraction: 0.25 },
    { screenProbes: 'high' as const },
  ])
    assert.ok(!held(screenProbeSettings(other)), JSON.stringify(other))
})

test('the kernels are keyed by what their code depends on: a switch of the occlusion recompiles those alone, the scene’s a flag of the parameters none', () => {
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
    [],
    'the scene stage is a flag of the parameters: no kernel',
  )
  assert.deepEqual(
    changed(keys({ screenProbes: 'high' })).sort(),
    [
      'composite',
      'convert',
      // The border of the filtered radiance reads the probes' records, whose program holds the samples a tile.
      'fixup',
      // The tiles' classification and the integration read the probes' samples a tile.
      'integrate',
      'occlusion',
      'place',
      'rays',
      'screenData',
      'spatial',
      'temporal',
      'tile',
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
