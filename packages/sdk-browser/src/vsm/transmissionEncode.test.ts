// A whole transmission frame encoded on the recording device under the binding rules the device
// enforces (`tests/kit/gpu/usageScope.ts`, `bindRules.ts`): every group set with its layout's
// dynamic offsets, every pipeline's groups set and of its layouts, every indirect buffer made for
// it — the frame whose index group, set with an offset its layout has no room for, lost the device.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { recordingEncoder } from '../../../../tests/kit/gpu/usageScope.ts'
import { shadowPageEntries } from '../webgpu/shadow/pageGroup.ts'
import { createVsmResources } from './resources.ts'
import { createVsmTransmission, encodeVsmTransmission } from './transmissionPass.ts'
import { emptyRowSpheres } from './rowPageBound.fixture.ts'

test('a transmission frame encodes clear, bin and resolve under the device’s binding rules', () => {
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 127, poolPages: 256 })
  const trans = createVsmTransmission(device, res.layout)
  const buffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM,
  })
  // The shadow page group, made as the engine makes it: one resource of its kind an entry.
  const pageLayout = device.createBindGroupLayout({ entries: shadowPageEntries() })
  const view = device
    .createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING })
    .createView()
  const pageGroup = device.createBindGroup({
    layout: pageLayout,
    entries: shadowPageEntries().map((e) => ({
      binding: e.binding,
      resource: e.buffer ? { buffer } : e.sampler ? device.createSampler() : view,
    })),
  })
  const { encoder, calls } = recordingEncoder()
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 1, shouldRender: true }]
  const binned = encodeVsmTransmission(
    encoder,
    res,
    trans,
    { device, lights, stamp: 1, rowFirst: 0, rowEnd: 4, used: 4 },
    {
      rowCount: 4,
      ...{ pageTable: buffer, spheres: buffer, mobility: buffer, rowLods: buffer },
      pageLayout,
      pageGroup,
      rowSpheres: emptyRowSpheres(),
      camera: {
        ...{ eye: [0, 0, 0], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        ...{ focalPixels: 100, near: 0.1, perspective: true, threshold: 1 },
      },
    },
  )
  assert.ok(binned, 'the blended rows are binned')
  const entries = calls.map((c) => c.entry)
  for (const kernel of [
    'vsmTransmissionClear',
    'vsmTransmissionCandidates',
    'vsmTransmissionPages',
    'vsmTransmissionBin',
    'vsmTransmissionNumber',
    'vsmTransmissionPlace',
    'vsmTransmissionResolve',
    'vsmTransmissionHeaders',
  ])
    assert.ok(entries.includes(kernel), kernel)
  // Past the clear and the argument kernels, every dispatch is indirect: a still frame runs none.
  const direct = calls.filter((c) => c.direct !== undefined).map((c) => c.entry)
  assert.deepEqual(
    [...new Set(direct)].filter((e) => e.startsWith('vsmTransmission')),
    ['vsmTransmissionClear', 'vsmTransmissionCandidates', 'vsmTransmissionNumber'],
  )
})
