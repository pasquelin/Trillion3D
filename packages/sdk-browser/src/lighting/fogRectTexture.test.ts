// A rectangle light that names a picture tints the light it gives the fog's volume by it (`volumetricFogRectLightTexture`): the scatter
// programs read the shared picture read (`rectSourceAt`) on the numbers of their layout, within WebGPU's default limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { withinDefaults } from '../gpu/core/stageLimits.fixture.ts'
import { FOG_BINDING, FOG_PROGRAM_BINDINGS } from './fog/bindings.ts'
import { FOG_VOLUME_FLAG } from './fog/frame.ts'
import { layoutEntries } from './fog/layoutEntries.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'

const SCATTERS = ['scatter', 'scatterSky', 'scatterSampled', 'scatterSkySampled'] as const

test('the setting is off by default, as the reference has it', () => {
  assert.equal(VOLUMETRIC_FOG_RULES.volumetricFogRectLightTexture.default, false)
})

test('every scatter reads the rectangle atlas through the shared picture read, tinting a local light only while the frame says so', () => {
  for (const name of SCATTERS) {
    const code = FOG_PROGRAMS[name]
    assert.ok(
      code.includes(`@group(0) @binding(${FOG_BINDING.rectAtlas}) var rectAtlas:texture_2d<f32>;`),
      `${name}: atlas at its number`,
    )
    assert.ok(
      code.includes(`@group(0) @binding(${FOG_BINDING.rectSampler}) var rectAtlasSampler:sampler;`),
      `${name}: sampler at its number`,
    )
    // One definition of the read: the real one, not the white default.
    assert.equal(code.match(/fn rectSourceAt\(/g)?.length, 1, `${name}: one rectSourceAt`)
    assert.match(code, /textureSampleLevel\(rectAtlas,rectAtlasSampler,at,level\)/)
    assert.match(
      code,
      new RegExp(
        `isRect\\(light\\)&&\\(u32\\(frame\\.medium\\.w\\)&${FOG_VOLUME_FLAG.rectTexture}u\\)!=0u\\)\\{colour\\*=fogRectPicture\\(light,P\\);\\}`,
      ),
    )
  }
  // The programs that light no cell bind no atlas.
  for (const name of ['furthest', 'static', 'integrate', 'prepare', 'voxelize'] as const)
    assert.ok(!('rectAtlas' in FOG_PROGRAM_BINDINGS[name]), name)
})

test('the scatters fit WebGPU default limits with the atlas bound', () => {
  const { device, pipelineLayouts } = fakeDevice()
  for (const name of SCATTERS)
    device.createPipelineLayout({
      bindGroupLayouts: [device.createBindGroupLayout({ entries: layoutEntries(name) })],
    })
  withinDefaults(pipelineLayouts, 'the fog scatters')
})
