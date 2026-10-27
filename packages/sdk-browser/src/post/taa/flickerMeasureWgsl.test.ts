// The flicker measure, the first stage of the shading rejection's program as the reference runs it: where
// it runs, what it writes, and what the rejection reads of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { REJECT_SHADING_BINDINGS, rejectShadingShader } from './rejectionWgsl.ts'

const REJECT = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
const REJECT_HALF = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float', true))
const REJECT_WAVE = wgslSource(
  rejectShadingShader('rgba8unorm', 'rgba16float', false, 'buffer', 'buffer', {
    lanes: 32,
    pinned: false,
  }),
)

test('the measure runs inside the rejection, only where the level rejects by it or an analysis view is shown', () => {
  for (const text of [REJECT, REJECT_HALF, REJECT_WAVE]) {
    assert.match(text, /fn measureFlicker\(/)
    assert.match(
      text,
      /var flick:Flicker;\n if\(flickerMeasured\(\)\)\{flick=measureFlicker\(pixel,place,writes,word,opaque,composed,layers,relax,relaxing&&thinAntiFlickers\(\),scale\);\}\n let cellError=flick\.error;/,
    )
    // The conditions are written once.
    assert.match(text, /fn flickerRejects\(\)->bool\{return view\.quality\.x>0\.0;\}/)
    assert.match(text, /fn analysisShown\(\)->bool\{return view\.params\.w>=4\.0;\}/)
    assert.match(
      text,
      /fn flickerMeasured\(\)->bool\{return flickerRejects\(\)\|\|analysisShown\(\);\}/,
    )
    // The relaxation reaches the measure only where the setting asks, the rejection whole.
    assert.match(text, /fn thinAntiFlickers\(\)->bool\{return view\.rates\.w>0\.0;\}/)
    assert.equal(text.match(/thinAntiFlickers\(\)/g)?.length, 2)
    assert.match(
      text,
      /measureRejection\(exposedInput,heldInput,historyHeld,cellError,relax,relaxing,/,
    )
    assert.equal(text.match(/view\.quality\.x/g)?.length, 1)
    assert.equal(text.match(/view\.params\.w>=4\.0/g)?.length, 1)
    // The rejection widens by the error where the level rejects by it.
    assert.match(text, /let flickerOn=flickerRejects\(\);/)
  }
})

test('the measure writes the flicker history of the texels the workgroup writes and hands its error and count to the rejection in registers', () => {
  for (const text of [REJECT, REJECT_HALF]) {
    assert.match(text, /if\(writes\[r\]\)\{textureStore\(flickerOut,place\[r\],vec4f\(/)
    assert.match(text, /out\.error\[r\]=saturate\(error\*still\[r\]-modification\[r\]\);/)
    assert.match(text, /out\.count\[r\]=kept\/20\.0;/)
    assert.doesNotMatch(text, /flickerError|flickerCell|FLICKER_CELL/)
  }
  // The count reaches the analysis view from the registers.
  assert.match(REJECT, /flick\.count\[r\]/)
  // In 16 bits the measure's values are half floats, in 32 bits none is.
  assert.match(REJECT_HALF, /struct Flicker\{error:array<f16,4>,count:array<f16,4>\}/)
  assert.match(REJECT, /struct Flicker\{error:array<f32,4>,count:array<f32,4>\}/)
})

test('the measure and the rejection are one dispatch over one tile', () => {
  assert.equal(REJECT.match(/@compute/g)?.length, 1)
  assert.equal(REJECT.match(/let origin=vec2i\(wg\.xy\)\*26-vec2i\(3\);/g)?.length, 1)
})

test('the rejection declares the flicker bindings its layout names, each once', () => {
  const declared = (text: string) =>
    [...text.matchAll(/@binding\((\d+)\) var(?:<[^>]*>)? (\w+)/g)].map((m) => [Number(m[1]), m[2]])
  const found = declared(REJECT)
  for (const [at, name] of [
    [REJECT_SHADING_BINDINGS.flicker, 'flicker'],
    [REJECT_SHADING_BINDINGS.measuredLuma, 'measuredLuma'],
    [REJECT_SHADING_BINDINGS.flickerOut, 'flickerOut'],
  ] as const)
    assert.ok(
      found.some(([binding, variable]) => binding === at && variable === name),
      name,
    )
  assert.equal(
    new Set(Object.values(REJECT_SHADING_BINDINGS)).size,
    Object.keys(REJECT_SHADING_BINDINGS).length,
  )
})
