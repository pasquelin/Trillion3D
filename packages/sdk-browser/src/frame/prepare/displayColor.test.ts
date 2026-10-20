// S11: drawn apart from the display — dynamic resolution, the default —, the composition writes the
// display and nothing reads a render-size display colour (4 B/px): none is made, with transmissive
// surfaces or not.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { runtime } from './targets.fixture.ts'
import { makeTargets, releaseTargets, targetsFit } from './targets.ts'
import { frameExtraBytes, frameTargetAllocation } from './targetAllocation.ts'
import { displayApart } from '../backend/state/renderScale.ts'

/** The targets of a 64 × 32 display drawn at `renderWidth`, the scene with water or not. */
function made(renderWidth: number, water: boolean) {
  const { rt } = runtime()
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  Object.assign(rt.gpu, { device: gpu.device })
  Object.assign(rt, {
    vis: { writesFeedback: true, writesEmissiveAo: true },
    capture: { capturing: false, captureAllocationBytes: 0 },
    // Water refracts: the distortion's targets are made full-size beside the frame's.
    blendState: {
      blendGpu: [],
      transmissive: water ? 1 : 0,
      refracts: water,
      refractGranted: false,
    },
  })
  const size = { width: 64, height: 32, renderWidth, renderHeight: renderWidth / 2, apart: true }
  const asked = frameTargetAllocation(rt, size)
  makeTargets(rt, gpu.device, size, asked)
  // The distortion's targets are charged beside the targets (`frameExtraBytes`); a scene without
  // it keeps two 1×1 stand-ins no one charges.
  const charged = gpu.textures.filter(
    ({ label, width }) => water || width > 1 || !/distortion/.test(label ?? ''),
  )
  const bytes =
    charged.reduce((sum, texture) => sum + (textureBytesOf(texture) ?? 0), 0) +
    gpu.buffers.reduce((sum, buffer) => sum + buffer.size, 0)
  const labels = gpu.textures.map(({ label }) => label)
  return { rt, gpu, size, asked, bytes, labels, extra: frameExtraBytes(rt, size) }
}

test('apart without water: no display colour, and the bytes made are the bytes asked', () => {
  for (const renderWidth of [32, 64]) {
    const { rt, size, asked, bytes, labels, extra } = made(renderWidth, false)
    assert.ok(!labels.includes('Trillion3D display color'), `at ${renderWidth}`)
    assert.equal(rt.gpu.colorTexture, undefined)
    assert.equal(rt.gpu.colorView, undefined)
    assert.ok(rt.gpu.displayView && displayApart(rt.gpu), 'the display is apart')
    assert.equal(bytes, asked + extra, 'frameTargetAllocation follows')
    assert.equal(targetsFit(rt, size), true, 'and the targets fit: nothing is remade')
  }
})

test('apart with transmissive surfaces: no display colour either', () => {
  for (const renderWidth of [32, 64]) {
    const { rt, size, asked, bytes, labels, extra } = made(renderWidth, true)
    assert.ok(!labels.includes('Trillion3D display color'), `at ${renderWidth}`)
    assert.equal(rt.gpu.colorView, undefined)
    assert.equal(bytes, asked + extra)
    assert.equal(targetsFit(rt, size), true)
  }
})

test('released, each texture is freed once', () => {
  const { rt, gpu } = made(64, true)
  releaseTargets(rt)
  const display = gpu.destroyed.filter(({ label }) => label === 'Trillion3D display')
  assert.equal(display.length, 1)
  assert.equal(new Set(gpu.destroyed).size, gpu.destroyed.length, 'no texture destroyed twice')
})
