// The translucency global illumination volume's programs: what the trace reads and adds, the cones' formats, the bindings against their layouts, the
// integration's writes and the radiance cache's level.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_GI_RULES } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { filterGiProgram } from './filterWgsl.ts'
import { integrateGiProgram } from './integrateWgsl.ts'
import { traceGiProgram, TRACE_GI_BINDINGS } from './traceWgsl.ts'
import { MARK_GI_PROGRAM } from './markWgsl.ts'
import { quantizationErrorsOf } from '../../post/taa/colorSpaceWgsl.ts'
import { translucencyGiConeFormat } from './layout.ts'

const values = resolveSettings(TRANSLUCENCY_GI_RULES, {})

test('the trace reads the volume’s own cache numbers over the screen probes’ parameters, copied to the thread', () => {
  assert.match(traceGiProgram('rgba16float'), /var<uniform> spBase:ScreenProbeParams/)
  assert.match(traceGiProgram('rgba16float'), /var<private> sp:ScreenProbeParams/)
  assert.match(traceGiProgram('rgba16float'), /sp=spBase;/)
  assert.match(traceGiProgram('rgba16float'), /sp\.cache=vec4f\(gi\.cache\.xyz/)
})

test('a cone’s light gets the sky light that leaks, the screen probes’ own, at the end of its ray, before the pre-exposure and the intensity limit', () => {
  const program = traceGiProgram('rgba16float')
  // One helper, shared with the screen probes: defined once, from the parameters the trace copies.
  assert.equal(program.match(/fn spSkyLeak\(/g)?.length, 1)
  // The end: the march's hit, the cache's distance, the furthest a ray looks where the cache covers none.
  assert.match(program, /var end=spMaxTrace\(\);/)
  assert.match(program, /if\(hit\)\{end=marched\.distance;\}/)
  assert.match(
    program,
    /let far=spFarOf\(giOrigin,d,gi\.trace\.x\);\s*light\+=far\.radiance;\s*end=far\.distance;/,
  )
  assert.match(program, /return light\+spSkyLeak\(d,end\);/)
  // The exposure and the limit come after the cone's light, as the reference's do.
  assert.match(
    program,
    /radiance=giCone\(equalAreaDecode\(\(cone\+noise\)\/f32\(res\)\)\)\*gi\.trace\.z;/,
  )
})

test('the cones’ light is in half floats by default, in the 11-11-10 floats where the setting asks and the device grants texture-formats-tier1, as the setting asks', () => {
  const tier1 = new Set(['texture-formats-tier1'])
  const none = new Set<string>()
  assert.equal(
    values.translucencyGiLightingDataFormat,
    'rgba16',
    'the default keeps more precision than the reference’s 11-11-10 floats, on purpose',
  )
  assert.equal(
    translucencyGiConeFormat(tier1, values.translucencyGiLightingDataFormat),
    'rgba16float',
  )
  assert.equal(
    translucencyGiConeFormat(tier1, 'r11g11b10'),
    'rg11b10ufloat',
    'the reference’s format',
  )
  assert.equal(translucencyGiConeFormat(none, 'r11g11b10'), 'rgba16float')
  assert.equal(translucencyGiConeFormat(tier1, 'rgba16'), 'rgba16float')
  assert.equal(translucencyGiConeFormat(none, 'rgba32'), 'rgba32float')
  // Only the 11-11-10 programs open with the language extension, and each dithers to its format’s mantissas (6, 6, 5 bits against 10).
  const packed = [
    traceGiProgram('rg11b10ufloat'),
    filterGiProgram('rg11b10ufloat'),
    integrateGiProgram('rg11b10ufloat'),
  ]
  const half = [
    traceGiProgram('rgba16float'),
    filterGiProgram('rgba16float'),
    integrateGiProgram('rgba16float'),
  ]
  for (const text of packed) {
    assert.match(text, /^requires texture_formats_tier1;/m)
    assert.match(text, /texture_storage_3d<rg11b10ufloat,write>/)
    assert.ok(text.includes(quantizationErrorsOf('rg11b10ufloat')))
  }
  for (const text of half) {
    assert.doesNotMatch(text, /^requires texture_formats_tier1;/m)
    assert.match(text, /texture_storage_3d<rgba16float,write>/)
    assert.ok(text.includes(quantizationErrorsOf('rgba16float')))
  }
})

test('the programs bind the textures and buffers their layouts name, and nothing twice', () => {
  for (const [name, text] of [
    ['mark', MARK_GI_PROGRAM],
    ['trace', traceGiProgram('rgba16float')],
    ['trace packed', traceGiProgram('rg11b10ufloat')],
    ['filter', filterGiProgram('rgba16float')],
    ['filter packed', filterGiProgram('rg11b10ufloat')],
    ['integrate', integrateGiProgram('rgba16float')],
    ['integrate packed', integrateGiProgram('rg11b10ufloat')],
  ] as const) {
    const bound = [...text.matchAll(/@group\((\d+)\) @binding\((\d+)\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    )
    assert.equal(new Set(bound).size, bound.length, `${name}: a binding twice`)
  }
  assert.equal(TRACE_GI_BINDINGS.at.frame, 1)
})

test('the integration writes the fog’s volume before the history and the intensity, then the volume the surfaces read as the reference splits it', () => {
  const text = integrateGiProgram('rgba16float')
  assert.match(text, /var fogVolume:texture_storage_3d/)
  const bound = [...text.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((m) => m[1])
  assert.deepEqual(bound.sort(), ['0', '1', '2', '3', '4', '5', '6', '7'])
  // The ambient light (the constant band, to the format’s precision) in the first texture, the luminance of each linear band in the second;
  // the history reads the two of the image before and rebuilds the linear bands with the ambient light’s colour.
  assert.match(
    text,
    /textureStore\(ambientVolume,id,vec4f\(giQuantize\(sh\.c\[0\],id\.xy,id\.z\),0\.0\)\)/,
  )
  assert.match(
    text,
    /textureStore\(directionalVolume,id,vec4f\(luminance\(sh\.c\[1\]\),luminance\(sh\.c\[2\]\),luminance\(sh\.c\[3\]\),0\.0\)\)/,
  )
  assert.match(
    text,
    /giSampleVolumes\(historyAmbient,historyDirectional,historySampler,uvw,slices\)/,
  )
  assert.match(text, /var ambientVolume:texture_storage_3d<rgba16float,write>/)
  assert.match(text, /var directionalVolume:texture_storage_3d<rgba16float,write>/)
  assert.match(
    integrateGiProgram('rg11b10ufloat'),
    /var ambientVolume:texture_storage_3d<rg11b10ufloat,write>/,
  )
})

test('the volume chooses the radiance cache’s level for its cell with the number one half: it gathers the probes and takes the reach from the level whose edge fade is past a half', () => {
  const program = traceGiProgram('rgba16float')
  assert.match(program, /const GI_COVERAGE_RANDOM:f32=0\.5;/)
  assert.match(program, /spCacheGatherOwnBiased\(giOrigin,bias,GI_COVERAGE_RANDOM\)/)
  assert.match(program, /spLocalReachBiased\(giOrigin,bias,GI_COVERAGE_RANDOM\)/)
})
