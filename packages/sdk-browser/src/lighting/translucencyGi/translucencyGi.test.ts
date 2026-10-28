// The translucency global illumination volume (`./`): the grid's law and its jitter, the harmonics the cones are projected on, the volume's own
// cache, the quality presets and when the volume is made.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  TRANSLUCENCY_GI_PRESET_LEVELS,
  TRANSLUCENCY_GI_RULES,
} from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { integrateGiProgram } from './integrateWgsl.ts'
import { GI_LIGHT_WGSL } from './frameWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { translucencyGiEndDistanceOf, wanted } from './settings.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  clipmapsCovering,
  translucencyCacheSettings,
  translucencyCacheShape,
} from './cacheShape.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import {
  TRANSLUCENCY_GI_GROUP,
  traceExtent,
  translucencyGiFootprintLevel,
  translucencyGiGrid,
  translucencyGiJitter,
  TRANSLUCENCY_GI_SLOT_SIDE,
  volumeExtent,
} from './layout.ts'

const values = resolveSettings(TRANSLUCENCY_GI_RULES, {})

test('the grid is the reference’s: cells of 32 pixels, slices on the logarithm of the distance out to 80 metres', () => {
  const grid = translucencyGiGrid(values, 1920, 1080, 0.1, 80)
  assert.deepEqual([grid.x, grid.y, grid.z, grid.shift], [60, 34, 26, 5])
  assert.deepEqual([grid.logZScale, grid.logZOffset, grid.zScale], [1, 1, 4])
  assert.deepEqual(traceExtent(grid, 3), [180, 102, 26])
  assert.deepEqual(
    volumeExtent(grid),
    [60, 34, 52],
    'the volume the surfaces read and the fog’s: the two halves stacked',
  )
  // A cell side that is not a power of two counts the cells by the side, the pyramid’s level by its logarithm.
  const odd = translucencyGiGrid(
    { ...values, translucencyGiGridPixelSize: 48 },
    1920,
    1080,
    0.1,
    80,
  )
  assert.deepEqual([odd.x, odd.y, odd.shift], [40, 23, 5])
  // A cell’s footprint is read in the pyramid’s texel two cells across (the reference’s mip, half the image’s size, one level above the cell’s), four where a cell is a pixel.
  assert.deepEqual([5, 1, 0].map(translucencyGiFootprintLevel), [6, 2, 2])
  // No span, one slice.
  assert.equal(translucencyGiGrid(values, 64, 64, 0.1, 0.05).z, 1)
})

test('the end distance is the setting scaled by the scene’s view distance over 20000 centimetres, the scale held to 0.1 to 100 and the result to 0.01 to 1000 metres', () => {
  const end = (viewDistance?: number, setting = values.translucencyGiEndDistance) =>
    translucencyGiEndDistanceOf(
      { context: { globalDistanceFieldTraceViewDistance: viewDistance } } as WebgpuPagesRuntime,
      { ...values, translucencyGiEndDistance: setting },
    )
  assert.equal(end(), 80, 'the default view distance leaves it')
  assert.equal(end(40000), 160)
  assert.equal(end(10000), 40)
  assert.ok(Math.abs(end(1000) - 8) < 1e-12, 'the scale is held to 0.1')
  assert.equal(end(1e7, 5), 500, 'and to 100')
  assert.equal(end(1e7), 1000, 'the distance to 1000 metres')
  assert.equal(end(1000, 0.05), 0.01, 'and to 0.01')
})

test('the jitter turns through the Halton sequence, or rests at the cell’s centre', () => {
  const out = new Float32Array(4)
  translucencyGiJitter(values, 3, out, 0)
  // Halton bases 2, 3 and 5 at the image's rank, the directions' turn its rank.
  const near = (got: number, want: number) =>
    assert.ok(Math.abs(got - want) < 1e-6, `${got} ${want}`)
  near(out[0], 0.75)
  near(out[1], 1 / 9)
  near(out[2], 0.6)
  assert.equal(out[3], 3)
  translucencyGiJitter({ ...values, translucencyGiTemporalJitter: false }, 3, out, 0)
  assert.deepEqual([...out], [0.5, 0.5, 0.5, -1])
  // The directions come round after `translucencyGiTemporalMaxRayDirections` images.
  translucencyGiJitter(values, 8, out, 0)
  assert.equal(out[3], 0)
})

test('a slice and its depth are each other’s inverse', () => {
  const run = shaderRun<{
    giDepthOfSlice: (slice: number) => number
    giSliceOfDepth: (depth: number) => number
  }>(integrateGiProgram('rgba16float', 'rgba16float'), ['giDepthOfSlice', 'giSliceOfDepth'], {
    gi: { zParams: [1, 1, 4, 0.1] },
  })
  for (const depth of [0.1, 1, 7.5, 80]) {
    const slice = run.giSliceOfDepth(depth)
    assert.ok(Math.abs(run.giDepthOfSlice(slice) - depth) < 1e-4 * depth)
  }
  // The end distance is the last slice: 26 slices from the near plane.
  assert.ok(Math.abs(run.giSliceOfDepth(80) - 4 * Math.log2(81)) < 1e-5)
})

test('a constant radiance projected on the harmonics gives its irradiance back: π times the radiance', () => {
  const radiance = 2
  const run = shaderRun<{
    giProject: (cell: number[]) => { c: number[][] }
  }>(integrateGiProgram('rgba16float', 'rgba16float'), ['giProject'], {
    gi: { trace: [3, 20, 1, 1] },
    cones: { load: () => [radiance, radiance, radiance, 0] },
  })
  // The surfaces' reading of the harmonics, the block the blends' fragment stage reads them by
  // (`readWgsl.ts`).
  const read = shaderRun<{
    giIrradiance: (light: number[][], N: number[], single: boolean) => number[]
  }>(wgslModule(GI_LIGHT_WGSL), ['giIrradiance'], {})
  const sh = run.giProject([0, 0, 0])
  // The constant band is exact: π times the radiance times the band’s basis, the sum the fog reads.
  assert.ok(Math.abs(sh.c[0][0] - Math.PI * radiance * 0.282095) < 1e-4)
  const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  // The volume the surfaces read holds four times that sum, the factor the reading takes out.
  const light = [sh.c[0].map((c) => 4 * c), [1, 2, 3].map((k) => 4 * luminance(sh.c[k]))]
  // The nine cones of a cell stand at the centres of the texels of the equal-area octahedron, one of them on the pole +z and none on -z: their
  // linear bands do not cancel along z, as the reference’s do not. Across the horizon they do, and the irradiance is π times the radiance.
  for (const N of [
    [0.6, 0.8, 0],
    [1, 0, 0],
    [0, -1, 0],
  ]) {
    const E = read.giIrradiance(light, N, false)
    E.forEach((c) =>
      assert.ok(Math.abs(c - Math.PI * radiance) < 0.02 * Math.PI * radiance, `${E}`),
    )
  }
  // Asked for the constant band alone, a surface reads the same under a constant sky, whatever its normal.
  for (const N of [
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const flat = read.giIrradiance(light, N, true)
    flat.forEach((c) => assert.ok(Math.abs(c - Math.PI * radiance) < 0.02 * Math.PI * radiance))
  }
})

test('the volume’s own cache is the reference’s: three levels of 24 cells over 2.08 m that cover 80 m, maps of 8 texels, a pool of 128 by 128 probes', () => {
  const shape = translucencyCacheShape(values, 80)
  assert.deepEqual(shape, {
    cascadeLevels: 3,
    cascadeSize: 24,
    cascadeHalfExtentMetres: 25,
    cascadeBase: 2,
    probePool: 16384,
  })
  // Each level reaches 25, 50, 100 m: the first past the distance ends the count.
  assert.equal(clipmapsCovering(80, 25, 2), 3)
  assert.equal(clipmapsCovering(24, 25, 2), 1)
  assert.equal(clipmapsCovering(25, 25, 2), 2, 'a reach equal to the distance does not cover it')
  assert.equal(clipmapsCovering(1e6, 25, 2), 6, 'at most the levels the uniform holds')
  const own = translucencyCacheSettings(screenProbeSettings(), values)
  assert.deepEqual(
    [
      own.radianceCache,
      own.cache.resolution,
      own.cache.mipmaps,
      own.cache.budget,
      own.cache.framesToKeepProbes,
      own.cache.skyVisibility,
      own.cache.minTraceScale,
    ],
    [true, 8, 3, 100, 8, false, 1],
  )
  // The rays start closer to the probes where the cells march no distance field themselves.
  const unmarched = resolveSettings(TRANSLUCENCY_GI_RULES, { translucencyGiTraceFromVolume: false })
  assert.equal(translucencyCacheSettings(screenProbeSettings(), unmarched).cache.minTraceScale, 0.1)
  // The trace, filter and tile settings stay the screen probes’: one set of settings for every cache.
  assert.equal(
    own.cache.temporaryAtlasDownsample,
    screenProbeSettings().cache.temporaryAtlasDownsample,
  )
})

/** The cells a side that a block of `group` cone texels a side, from a multiple of `group`, touches for `tracing` cones a cell side: the most over
 *  the blocks (the block's offset in its first cell takes every value the multiples of `group` give modulo `tracing`). */
function giSlotSide(tracing: number, group: number = TRANSLUCENCY_GI_GROUP) {
  let most = 1
  for (let block = 0; block < tracing; block++)
    most = Math.max(most, Math.floor((((block * group) % tracing) + group - 1) / tracing) + 1)
  return most
}

test('a trace workgroup’s block of cone texels touches no more cells a side than the slots it shares them in', () => {
  // One cone a cell shares nothing (a thread a cell); from two a side, the block is within the slots at every size the setting allows.
  for (let tracing = 2; tracing <= 16; tracing++)
    assert.ok(giSlotSide(tracing) <= TRANSLUCENCY_GI_SLOT_SIDE, `${tracing}`)
  assert.equal(
    Math.max(...Array.from({ length: 15 }, (_, k) => giSlotSide(k + 2))),
    TRANSLUCENCY_GI_SLOT_SIDE,
  )
})

test('the quality presets write the reference’s rows of the volume: cells of 128, 64 and 32 pixels, the march from the third level, four cones at the top', () => {
  const levels = TRANSLUCENCY_GI_PRESET_LEVELS
  assert.deepEqual(levels.smooth, {})
  assert.deepEqual(levels.balanced, {
    translucencyGiGridPixelSize: 128,
    translucencyGiTraceFromVolume: false,
    translucencyGiShareRadianceCacheWithOpaque: true,
    translucencyGiSpatialFilter: false,
    translucencyGiRadianceCacheGridResolution: 12,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 30,
  })
  assert.deepEqual(levels.fine, {
    translucencyGiGridPixelSize: 64,
    translucencyGiTraceFromVolume: false,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 70,
  })
  assert.deepEqual(levels.cinematic, {
    translucencyGiTracingResolution: 4,
    translucencyGiRadianceCacheProbeResolution: 16,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 350,
  })
  // The default level, the one that writes nothing, is the reference’s third row: cells of 32 pixels, the march on, three cones a side.
  assert.deepEqual(
    [
      values.translucencyGiGridPixelSize,
      values.translucencyGiTraceFromVolume,
      values.translucencyGiTracingResolution,
    ],
    [32, true, 3],
  )
  // Every preset value is a value its rule takes.
  for (const level of Object.values(levels)) resolveSettings(TRANSLUCENCY_GI_RULES, level)
})

test('the volume is made whenever it is enabled, the lit image shown and the screen probes cast, with no blended surface nor fog volume in the scene', () => {
  // A scene that holds neither (`vis.blendPipelines` none): only the setting, the lit image and the screen probes decide.
  const scene = (more: { bounce?: boolean; unlit?: boolean }) =>
    ({
      vis: {},
      context: {},
      bounce: { wanted: more.bounce ?? true },
      lights: { store: { unlit: more.unlit ?? false } },
      run: { diagnostic: 'beauty' },
    }) as unknown as WebgpuPagesRuntime
  assert.equal(wanted(scene({}), values), true)
  assert.equal(wanted(scene({}), { ...values, translucencyGi: false }), false)
  assert.equal(wanted(scene({ bounce: false }), values), false, 'no screen probes cast')
  assert.equal(wanted(scene({ unlit: true }), values), false, 'the lit image is not shown')
})

// The volume the surfaces read holds the ambient and the directional light in the two halves of one texture (`giSampleVolume`) in place of two
// textures (`giSampleVolumes`, gone): the same depth coordinate, held half a slice inside, so that the trilinear filter never mixes the halves.
test('a point read in the stacked volume is the point read in each of the two textures, at the edges of the depth as inside it', () => {
  const slices = 5
  const ambient = [0.1, 0.9, 0.3, 0.7, 0.5]
  const directional = [-2, 4, -6, 8, -10]
  const stacked = [...ambient, ...directional]
  /** The hardware's linear filter along the depth of a texture of `texels`, the edge held: a coordinate in [0, 1] of the texture's depth. */
  const filtered = (texels: number[], coordinate: number) => {
    const at = coordinate * texels.length - 0.5
    const first = Math.floor(at)
    const t = at - first
    const read = (k: number) => texels[Math.min(Math.max(k, 0), texels.length - 1)]
    return read(first) * (1 - t) + read(first + 1) * t
  }
  const inside = (w: number) => Math.min(Math.max(w * slices, 0.5), slices - 0.5)
  for (const w of [
    0,
    0.5 / slices,
    0.1,
    0.2,
    0.37,
    0.5,
    0.75,
    1 - 0.5 / slices,
    0.999,
    1,
    1.2,
    -0.3,
  ]) {
    const separate = [ambient, directional].map((texels) => filtered(texels, inside(w) / slices))
    const halves = [0, 1].map((slab) =>
      filtered(stacked, (inside(w) + slab * slices) / (2 * slices)),
    )
    halves.forEach((value, k) =>
      assert.ok(Math.abs(value - separate[k]) < 1e-12, `w ${w}, half ${k}`),
    )
  }
})
