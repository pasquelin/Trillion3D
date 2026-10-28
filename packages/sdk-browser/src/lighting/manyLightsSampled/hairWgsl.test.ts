import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { hairLightPassWgsl } from '../../hair/hairLightWgsl.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { HAIR_SURFACE_TRACE_ENTRY, hairSurfaceTraceWgsl } from './hairSurfaceTraceWgsl.ts'
import { HAIR_MASK_ENTRY, HAIR_SAMPLE_ENTRY, hairMaskWgsl, hairSampleWgsl } from './hairWgsl.ts'

test('the surfaces’ rays are marched through the strands’ voxels with the traversal the strands already use', () => {
  const code = hairSurfaceTraceWgsl()
  assert.ok(
    code.includes(`fn ${HAIR_SURFACE_TRACE_ENTRY}(`) &&
      code.includes('traceVoxels(') &&
      code.includes('hideSample(c)'),
  )
  assert.ok(
    code.includes('lightSampleTrace(') && code.includes('params.macroGroupCount'),
    'toward the point of the light the sample picks, over the macro groups',
  )
})

test('the strands’ samples draw their lights, trace their transmittance through the voxels, and the pass reads the draws', () => {
  assert.ok(hairSampleWgsl().includes(`fn ${HAIR_SAMPLE_ENTRY}(`))
  const masks = hairMaskWgsl(false)
  assert.ok(
    masks.includes(`fn ${HAIR_MASK_ENTRY}(`) &&
      masks.includes('traceVoxels(') &&
      masks.includes('lightSampleTrace('),
  )
  const key = { ...FULL_CONTRACT, lobeless: true }
  const sampled = wgslModule(hairLightPassWgsl(key, true))
  const plain = wgslModule(hairLightPassWgsl(key))
  assert.ok(
    sampled.includes('hairDraws') &&
      sampled.includes('hairDrawnActive') &&
      !sampled.includes('sliceLighting(base.rgb'),
    'the sampled form lights the draws and the suns',
  )
  assert.ok(
    !plain.includes('hairDraws') &&
      !plain.includes('hairDrawnActive') &&
      plain.includes('sliceLighting(base.rgb'),
    'the plain form is unchanged',
  )
})
