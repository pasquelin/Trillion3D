// The traced translucency's denoising (`denoiseWgsl.ts`): the three programs assemble, each group binds each binding once within the stage limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  RTT_PASS_ENTRIES,
  RTT_RESOLVE_ENTRY,
  RTT_SPATIAL_ENTRY,
  RTT_TEMPORAL_ENTRY,
  tracedTranslucencyDenoiseProgram,
} from './denoiseWgsl.ts'

const passes = [RTT_RESOLVE_ENTRY, RTT_TEMPORAL_ENTRY, RTT_SPATIAL_ENTRY] as const
const code = (entry: (typeof passes)[number]) => tracedTranslucencyDenoiseProgram(entry)

test('each pass assembles and its own text holds no backtick', () => {
  for (const entry of passes) {
    const text = code(entry)
    assertProgramAssembles(text)
    assert.ok(!text.slice(text.indexOf('struct RttParams')).includes('`'))
  }
})

test('each group binds each binding once, with no more than the four storage textures a stage may hold', () => {
  for (const entry of passes) {
    const entries = RTT_PASS_ENTRIES[entry]()
    const bindings = entries.map((e) => e.binding)
    assert.equal(new Set(bindings).size, bindings.length)
    assert.ok(entries.filter((e) => e.storageTexture).length <= 4)
  }
})

test('a pixel no transparent surface covers composes nothing: radiance zero, throughput one', () => {
  assert.match(code(RTT_RESOLVE_ENTRY), /if\(!rttCovered\(pixel\)\)\{/)
  assert.match(code(RTT_RESOLVE_ENTRY), /textureStore\(rttFinalThroughput,pixel,vec4f\(1\.0\)\)/)
  assert.match(code(RTT_SPATIAL_ENTRY), /textureStore\(rttFinalRadiance,pixel,vec4f\(0\.0\)\)/)
})

test('the temporal pass reads the history where the light came from and at the front layer, whose texels keep as their depth agrees', () => {
  const text = code(RTT_TEMPORAL_ENTRY)
  assert.match(text, /eye-V\*resolved\.a/)
  assert.match(text, /abs\(past\.x-depth\)>=depth\*threshold/)
  assert.match(text, /clamp\(hitY,lo,hi\),clamp\(surfaceY,lo,hi\),alpha/)
})

test('the spatial pass filters after the temporal one, by depth, normal and luminance, where the history is short or noisy', () => {
  const text = code(RTT_SPATIAL_ENTRY)
  assert.match(text, /noisy\|\|disocclusion>0\.01\)&&radius>1\.0/)
  assert.match(text, /let w=level\*across\*near;/)
  assert.match(text, /reflectionReuseTap\(k,taps,seed\)/)
})
