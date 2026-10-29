// The format an atlas of light is stored in: chosen by the setting and the device, one WGSL source for the four, and the word format writing the text the passes held before the setting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { cacheFilterProgram } from '../../lighting/bounce/cache/cacheFilterWgsl.ts'
import { cacheFixupProgram } from '../../lighting/bounce/cache/cacheFixupWgsl.ts'
import {
  cacheFilterEntries,
  cacheFixupEntries,
  cacheSplatEntries,
  cacheTilesEntries,
  cacheTraceEntries,
} from '../../lighting/bounce/cache/cacheBindings.ts'
import {
  cacheSplatProgramOf,
  cacheTracedProgramOf,
  cacheTraceProgramOf,
} from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import {
  cacheBytes,
  cacheTempBytes,
  cacheTraceBytes,
  radianceCacheFormats,
  radianceCacheTempFormats,
} from '../../lighting/bounce/cache/cacheLayout.ts'
import {
  fieldGatherEntries,
  fieldGatherProgram,
} from '../../lighting/bounce/irradianceField/gatherWgsl.ts'
import {
  irradianceEntries,
  irradianceProgram,
  occlusionEntries,
  occlusionProgram,
} from '../../lighting/bounce/irradianceField/mapsWgsl.ts'
import { raysEntries, raysShader } from '../../lighting/bounce/screen/importanceWgsl.ts'
import { screenStageShader } from '../../lighting/bounce/screen/stageShader.ts'
import { traceMeshEntries, traceMeshShader } from '../../lighting/bounce/screen/traceMeshWgsl.ts'
import { traceSceneEntries, traceSceneShader } from '../../lighting/bounce/screen/traceSceneWgsl.ts'
import { traceGiEntries, traceGiProgram } from '../../lighting/translucencyGi/traceWgsl.ts'
import { lightWordsOf } from './lightWords.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasDeps,
  lightAtlasFormat,
  lightAtlasSampleType,
  lightOfTexel,
  lightTexel,
  withLightAtlasEntry,
  type LightAtlasFormat,
} from './lightAtlasFormat.ts'
const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)
const CACHE_SPLAT_PROGRAM = cacheSplatProgramOf(WORD_LIGHT_FORMAT)
const digest = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)

const TIER1 = { has: (name: string) => name === 'texture-formats-tier1' }
const NONE = { has: () => false }

test('the setting and the device choose the format: native 11-11-10 with the tier, the word without it, the floats as asked', () => {
  assert.equal(lightAtlasFormat('r11g11b10', TIER1), 'rg11b10ufloat')
  assert.equal(lightAtlasFormat('r11g11b10', NONE), 'r32uint')
  for (const features of [TIER1, NONE]) {
    assert.equal(lightAtlasFormat('rgba16', features), 'rgba16float')
    assert.equal(lightAtlasFormat('rgba32', features), 'rgba32float')
  }
  assert.equal(lightAtlasSampleType('r32uint'), 'uint')
  for (const format of ['rg11b10ufloat', 'rgba16float', 'rgba32float'] as const)
    assert.equal(lightAtlasSampleType(format), 'unfilterable-float')
})

test('the word format writes the text the passes held before the setting existed (golden digests of the programs, layouts and sizes)', () => {
  const shape = { resolution: 16, mipmaps: 3, skyVisibility: true, light: WORD_LIGHT_FORMAT }
  const formats = [
    radianceCacheFormats(WORD_LIGHT_FORMAT),
    radianceCacheTempFormats(WORD_LIGHT_FORMAT),
  ]
  const got = {
    fixup: digest(cacheFixupProgram(WORD_LIGHT_FORMAT)),
    filter: digest(cacheFilterProgram(WORD_LIGHT_FORMAT)),
    trace: digest(CACHE_TRACE_PROGRAM),
    splat: digest(CACHE_SPLAT_PROGRAM),
    traced: digest(CACHE_TRACED_PROGRAM),
    irradiance: digest(irradianceProgram(8)),
    occlusion: digest(occlusionProgram(8)),
    gather: digest(fieldGatherProgram()),
    rays: digest(raysShader(8, 8, [4, 4])),
    scene: digest(traceSceneShader(8, [4, 4], false)),
    sceneFog: digest(traceSceneShader(8, [4, 4], true)),
    mesh: digest(traceMeshShader(8, [4, 4], false)),
    stage: digest(
      screenStageShader(
        { side: 8, samples: [4, 4], light: WORD_LIGHT_FORMAT },
        wgslBlock('X', [], 'fn x(){}'),
      ),
    ),
    gi: digest(traceGiProgram('rgba16float')),
    entries: digest([
      cacheFixupEntries(),
      cacheFilterEntries(),
      cacheTraceEntries(),
      cacheSplatEntries(),
      cacheTilesEntries(),
      irradianceEntries(),
      occlusionEntries(),
      fieldGatherEntries(),
      raysEntries(),
      traceSceneEntries(false),
      traceSceneEntries(true),
      traceMeshEntries(),
      traceGiEntries('rgba16float'),
    ]),
    formats: digest([
      ...formats,
      cacheBytes(shape, 4096),
      cacheTempBytes(shape, { row: 8, probes: 64 }),
      cacheTraceBytes(512, WORD_LIGHT_FORMAT),
    ]),
  }
  // gather, rays, scene, sceneFog, mesh, stage and gi are re-pinned: they include shared libraries other agents changed since, none in the cache or the screen probes' light format: the sky cube's face tables (`FACE_PERM`/`FACE_SIGN`, modules/sky/skyLight/cubeWgsl.ts), the depth pyramid's `hizFoldOf`/`hizCellFurthest` (visibility/hiz) and the screen probe's tile word and moving flag (bounce/screen, irradianceField/pixelsTile.ts).
  // Re-pinned again, with trace and traced, after the cleanup of 28/10: the shared mesh distance-field read the surface cache's mesh sun pre-pass
  // moved into (`meshShadowWgsl.ts`, `directWgsl.ts`), c9's deduplication (`sinFromCosUnclamped`, `workgroupSumLoop`, `PROBE_PIXEL_BINDINGS`) and
  // the screen probes' pieces moved to leaf modules (`stageShader.ts`, `traceFeatureWgsl.ts`): the word format's own reads are unchanged.
  // Re-pinned after c9's deduplication of 29/10: the mesh trace's segment-box span, depth and table reads come from their one owner
  // (`segmentBoxSpan`, `viewDepthCmOfDevice`, `SURFACE_TABLE_WORDS_WGSL`): the same operations, the text laid out in another order.
  // And after the fourth sweep: the screen edge's vignette, the held layers' read and the sky's irradiance guard from their one owner.
  // Re-pinned, with splat and traced, for the range test of the cache trace: a thread whose texel lies past the level's rays traces none and writes none.
  // Re-pinned after the morning's sweeps of 29/10, which changed these programs' shared text; and for the screen probes' rays, whose noise is drawn at their probe's tile (`spRayNoiseTexel`) and whose hits tell motion by one test (`spHitMoving`).
  // Re-pinned for the eye's words the screen probes' parameters hold and the two pose tables the scene stage binds: a hit of the field's march takes the speed of the placement that lit it (`spMarchMoving`).
  assert.deepEqual(got, {
    fixup: '9bfe3a2ea6d87e7f',
    filter: '7750a8b19dac1573',
    trace: 'a521be1163dacc40',
    splat: 'eb33fad2048864a8',
    traced: 'f56969f44362fbe9',
    irradiance: '6910ef3e1b772e26',
    occlusion: '2d5a1e78d06440ec',
    gather: '7b9bf7a82866a0be',
    rays: 'a9e9d8034a8949c1',
    scene: 'fc7d7e94b7343e17',
    sceneFog: '42f52bf70d32bdde',
    mesh: '243a9726b3dab774',
    stage: 'c430211b501cfedb',
    gi: 'beb3b9084551952f',
    entries: '7398b779b1621dda',
    formats: '1f3697191cf3afc0',
  })
})

test('the native 11-11-10 texel holds what the word decodes to: the same rounding, stored exactly', () => {
  assert.equal(lightTexel('r32uint', 'c', 'e'), 'vec4u(packLight(ditherLight(c,e)),0u,0u,0u)')
  assert.equal(
    lightTexel('rg11b10ufloat', 'c', 'e'),
    'vec4f(unpackLight(packLight(ditherLight(c,e))),1.0)',
  )
  // The half and single floats store the light as it is: no rounding to 11-11-10 mantissas, so no dither.
  for (const format of ['rgba16float', 'rgba32float'] as const)
    assert.equal(lightTexel(format, 'c', 'e'), 'vec4f(c,1.0)')
  assert.equal(lightOfTexel('r32uint', 't'), 'unpackLight(t.r)')
  assert.equal(lightOfTexel('rg11b10ufloat', 't'), 't.rgb')
})

test('each format makes the passes it reaches: the declarations, the storage format and the language extension follow it', () => {
  const formats: LightAtlasFormat[] = ['r32uint', 'rg11b10ufloat', 'rgba16float', 'rgba32float']
  for (const format of formats) {
    const fixup = cacheFixupProgram(format)
    const filter = cacheFilterProgram(format)
    assert.match(fixup, new RegExp(`texture_storage_2d<${format},write> *;`))
    assert.match(filter, new RegExp(`filteredOut:texture_storage_2d<${format},write>`))
    assert.equal(/requires texture_formats_tier1;/.test(fixup), format === 'rg11b10ufloat')
    assert.equal(/fn packLight\(/.test(fixup), format === 'r32uint' || format === 'rg11b10ufloat')
    // The raw atlas is read as words whatever the format.
    assert.match(fixup, /fn unpackLight\(/)
    assert.match(filter, /fn unpackLight\(/)
    const wordly = format === 'r32uint'
    assert.match(
      raysShader(8, 8, [4, 4], format),
      new RegExp(`var cacheFinal:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    assert.match(
      traceSceneShader(8, [4, 4], false, [], format),
      new RegExp(`var cacheFinal:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    assert.match(
      irradianceProgram(8, format),
      new RegExp(`var finalIn:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    assert.match(
      fieldGatherProgram(format),
      new RegExp(`var finalAtlas:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    assert.match(
      traceGiProgram('rgba16float', format),
      new RegExp(`var cacheFinal:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    // The layouts bind what the programs declare.
    const sample = (entries: readonly GPUBindGroupLayoutEntry[], binding: number) =>
      entries.find((entry) => entry.binding === binding)?.texture?.sampleType
    assert.equal(sample(cacheFixupEntries(format), 5), lightAtlasSampleType(format))
    assert.equal(
      cacheFixupEntries(format).find((entry) => entry.binding === 7)?.storageTexture?.format,
      format,
    )
    assert.equal(
      cacheFilterEntries(format).find((entry) => entry.binding === 5)?.storageTexture?.format,
      format,
    )
    assert.equal(sample(irradianceEntries(format), 4), lightAtlasSampleType(format))
    assert.equal(sample(raysEntries(format), 13), lightAtlasSampleType(format))
    assert.equal(sample(traceSceneEntries(false, format), 18), lightAtlasSampleType(format))
    assert.equal(sample(traceGiEntries('rgba16float', format), 18), lightAtlasSampleType(format))
  }
  assert.deepEqual(
    lightAtlasDeps('rgba16float').map((decl) => decl.name),
    ['unpackLight'],
  )
})

test('the maps are stored in the format, the raw atlas holds the light in its words beside the distance, and the bytes follow the format', () => {
  const base = { resolution: 16, mipmaps: 3, skyVisibility: true }
  const bytes = (light: LightAtlasFormat) => cacheBytes({ ...base, light }, 4096)
  assert.equal(bytes('rg11b10ufloat'), bytes('r32uint'))
  assert.ok(bytes('rgba16float') > bytes('r32uint'))
  assert.ok(bytes('rgba32float') > bytes('rgba16float'))
  for (const light of ['r32uint', 'rg11b10ufloat', 'rgba16float', 'rgba32float'] as const) {
    assert.equal(radianceCacheFormats(light).final, light)
    // The raw atlas holds the light's words and the distance word: two words where the light is one, four else.
    assert.equal(
      radianceCacheFormats(light).raw,
      lightWordsOf(light) === 1 ? 'rg32uint' : 'rgba32uint',
    )
    assert.equal(radianceCacheTempFormats(light).trace, radianceCacheFormats(light).raw)
    assert.equal(radianceCacheTempFormats(light).filtered, light)
  }
  assert.equal(withLightAtlasEntry([], 3, 'r32uint').length, 0)
})
