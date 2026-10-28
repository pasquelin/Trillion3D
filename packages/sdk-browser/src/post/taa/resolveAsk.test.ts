// The history updates of the temporal pass — the display's size writes the half-size image, a larger history's resolve writes it — are both compiled with the pass: the history
// made later compiles nothing new.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createTaaResolves } from './resolve.ts'
import { taaExecutionOf } from './waveOps.ts'

test('both updates are asked with the pass: asking them again when the history is made compiles nothing', async () => {
  const gpu = fakeDevice()
  const device = gpu.device as GPUDevice
  const made: string[] = []
  const compute = device.createComputePipeline.bind(device)
  device.createComputePipeline = (d) => (made.push(d.label ?? ''), compute(d))
  const createAsync = device.createComputePipelineAsync.bind(device)
  device.createComputePipelineAsync = async (d) => (made.push(d.label ?? ''), createAsync(d))
  const resolves = await createTaaResolves(device, taaExecutionOf(device, false, 0, false), false)
  await new Promise((done) => setImmediate(done))
  const updates = () => made.filter((label) => label.startsWith('TAA_UPDATE'))
  assert.ok(updates().length >= 2, 'the update with the half-size image and the one without')
  const before = updates().length
  resolves.ask(true)
  resolves.ask(false)
  await new Promise((done) => setImmediate(done))
  assert.equal(updates().length, before, 'the history made later compiles nothing new')
})
