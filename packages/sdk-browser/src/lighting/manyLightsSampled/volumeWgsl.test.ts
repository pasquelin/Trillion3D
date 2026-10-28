import test from 'node:test'
import assert from 'node:assert/strict'
import { injectProgram } from '../translucency/injectWgsl.ts'
import { FOG_PROGRAMS } from '../fog/programs.ts'
import { FOG_PROGRAM_BINDINGS } from '../fog/bindings.ts'
import { volumeHashText, volumeSampleText } from './volumeText.ts'
import { VOLUME_HASH_ENTRY, VOLUME_PARAMS_WORDS, VOLUME_SAMPLE_ENTRY } from './volumeWgsl.ts'

test('the sampled lighting’s volume is sampled and hashed apart from the fog, and read by the fog’s scatter and the translucency volume', () => {
  const sample = volumeSampleText({ field: false, pyramid: false })
  const sky = volumeSampleText({ field: true, pyramid: true })
  assert.ok(sample.includes(`fn ${VOLUME_SAMPLE_ENTRY}(`))
  assert.ok(
    sky.includes('gdfTrace(') &&
      sky.includes('fn fogFurthestOver(') &&
      sky.includes('hizOpaqueDepth('),
    'the field’s ray and the pyramid are in the variant that binds them',
  )
  assert.ok(!sample.includes('gdfTrace(') && !sample.includes('hizOpaqueDepth('), 'and only there')
  assert.ok(
    !sample.includes('frame.') && !sample.includes('shadowFactor('),
    'the fog’s frame and the shadow maps are not read: the sampling needs no fog',
  )
  assert.ok(volumeHashText().includes(`fn ${VOLUME_HASH_ENTRY}(`))
  for (const name of ['scatterSampled', 'scatterSkySampled'] as const) {
    assert.ok(FOG_PROGRAMS[name].includes('fn mlVolumeLight('), `${name} reads the volume`)
    assert.ok(
      !FOG_PROGRAMS[name].includes('fogLocal(rank,P,toEye,biasSquared,fade);'),
      `${name} no longer walks the cell’s list`,
    )
  }
  assert.ok(!FOG_PROGRAMS.scatter.includes('mlVolumeLight'), 'the plain scatter holds none of it')
  assert.ok(
    FOG_PROGRAM_BINDINGS.scatterSampled.mlSamplesIn &&
      !('mlSamplesIn' in FOG_PROGRAM_BINDINGS.scatter),
  )
  assert.equal(
    VOLUME_PARAMS_WORDS,
    128,
    'the uniform: seven vectors of words, five of floats, a matrix, four vectors, two matrices, four vectors',
  )
  const injection = injectProgram(true)
  assert.ok(
    injection.includes('fn mlTake(') && injection.includes('tvInjectWeighted('),
    'the translucency volume’s injection reads the samples',
  )
  assert.ok(!injectProgram(false).includes('mlTake('), 'and the plain one does not')
})
