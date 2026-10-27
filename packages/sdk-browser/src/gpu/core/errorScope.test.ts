import test from 'node:test'
import assert from 'node:assert/strict'
import { buildComputeStage, buildComputeStages } from './computeStages.ts'
import { deviceMadeNow, madeChecked, validatedOrWhy, validationScope } from './errorScope.ts'
import { createDeferred } from '../../../../sdk-core/src/runtime/deferred.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** The `uncapturederror` messages `device` dispatches from now on, each cancelled. */
function uncapturedOf(device: GPUDevice) {
  const messages: string[] = []
  device.addEventListener('uncapturederror', (event) => {
    event.preventDefault()
    messages.push((event as unknown as { error: { message: string } }).error.message)
  })
  return messages
}

test("a build raises, then awaits: an error raised meanwhile is the device's, not the build's", async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  const uncaptured = uncapturedOf(device)
  const waiting = createDeferred<void>()
  const building = validationScope(device, async () => {
    gpu.raise('[Device] the build refused')
    await waiting.promise
    return 'built'
  })
  assert.equal(gpu.scopes.length, 0, 'the scope closed with the synchronous part of the build')
  gpu.raise('[Shader] an unrelated module')
  waiting.resolve()
  const { value, error } = await building
  assert.equal(value, 'built')
  assert.equal(error?.message, '[Device] the build refused')
  assert.deepEqual(uncaptured, ['[Shader] an unrelated module'])
})

test('a build that throws, or whose promise rejects, closes its scope and rethrows', async () => {
  const gpu = fakeDevice()
  await assert.rejects(
    validationScope(gpu.device, () => {
      throw new Error('thrown at once')
    }),
    /thrown at once/,
  )
  await assert.rejects(
    validationScope(gpu.device, async () => {
      await Promise.resolve()
      throw new Error('rejected later')
    }),
    /rejected later/,
  )
  assert.equal(gpu.scopes.length, 0, 'every scope pushed is popped')
})

test("deviceMadeNow opens and closes its scope before it returns, nested in the caller's", async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  device.pushErrorScope('validation')
  deviceMadeNow(
    device,
    () => ({ destroy() {} }),
    () => {},
  )
  assert.equal(gpu.scopes.length, 1, 'only the scope open around it stays open')
  assert.equal(await device.popErrorScope(), null)
})

test("madeChecked closes its scope before use starts; the scope's own message wins over a rejection of use", async () => {
  const gpu = fakeDevice()
  const made = madeChecked(
    gpu.device,
    () => 'made',
    async (value) => (assert.equal(gpu.scopes.length, 0), `${value} used`),
  )
  assert.equal(gpu.scopes.length, 0, 'the scope is closed when it returns')
  assert.equal(await made, 'made used')
  const failing = async () => {
    throw new Error('use failed')
  }
  await assert.rejects(
    madeChecked(gpu.device, () => gpu.raise('[PipelineLayout] refused'), failing),
    (error: Error) => {
      assert.ok(error instanceof GPUPipelineError)
      assert.equal(error.message, '[PipelineLayout] refused')
      return true
    },
  )
  await assert.rejects(
    madeChecked(gpu.device, () => 'made', failing),
    /use failed/,
  )
  assert.equal(gpu.scopes.length, 0)
})

test("a build that rejects while the scope holds an error is refused with the scope's message", async () => {
  const gpu = fakeDevice()
  const refusing = validationScope(gpu.device, async () => {
    gpu.raise('[Device] the scope holds this')
    await Promise.resolve()
    throw new Error('the build failed')
  })
  await assert.rejects(refusing, (error: Error) => {
    assert.ok(error instanceof GPUPipelineError)
    assert.equal(error.message, '[Device] the scope holds this')
    return true
  })
  assert.deepEqual(
    await validatedOrWhy(gpu.device, async () => {
      gpu.raise('[Device] the scope holds this')
      throw new Error('the build failed')
    }),
    { refused: '[Device] the scope holds this' },
  )
})

test('a device without the async variant builds its compute pipeline on a scope of its own', async () => {
  const gpu = fakeDevice({ asyncPipelines: false })
  const { device } = gpu
  const module = device.createShaderModule({ code: '' })
  const descriptor: GPUComputePipelineDescriptor = {
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  }
  const built = buildComputePipeline(device, descriptor)
  assert.equal(gpu.scopes.length, 0, 'the scope is closed when it returns')
  assert.ok(await built)
  const create = device.createComputePipeline.bind(device)
  device.createComputePipeline = (given) => (gpu.raise('[Pipeline] refused'), create(given))
  await assert.rejects(buildComputePipeline(device, descriptor), (error: Error) => {
    assert.ok(error instanceof GPUPipelineError)
    assert.equal(error.message, '[Pipeline] refused')
    return true
  })
})

test('the stages of one module share one pipeline layout, made in one scope', async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  let opened = 0
  const push = device.pushErrorScope.bind(device)
  device.pushErrorScope = (filter) => (opened++, push(filter))
  const module = device.createShaderModule({ code: '' })
  const stages = await buildComputeStages(device, [], module, ['a', 'b', 'c'])
  assert.deepEqual(Object.keys(stages), ['a', 'b', 'c'])
  assert.equal(gpu.pipelineLayouts.length, 1)
  assert.equal(opened, 1)
  assert.equal(gpu.computePipelines.length, 3)
  assert.equal(new Set(gpu.computePipelines.map(({ layout }) => layout)).size, 1)
})

test('strictScopes throws on a creation made outside any scope, and passes inside one', async () => {
  const { device } = fakeDevice({ strictScopes: true })
  const buffer = { label: 'loose', size: 4, usage: GPUBufferUsage.STORAGE }
  assert.throws(
    () => device.createBuffer(buffer),
    /created outside any error scope: createBuffer loose/,
  )
  device.pushErrorScope('validation')
  device.createBuffer(buffer)
  const module = device.createShaderModule({ code: '' })
  await device.popErrorScope()
  // A pipeline compiled off the thread is judged by its own promise: no scope needed.
  await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'a' } })
})

test('a pipeline layout the device refuses after an await refuses the build, with no uncaptured error', async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  const uncaptured = uncapturedOf(device)
  const made = device.createPipelineLayout.bind(device)
  device.createPipelineLayout = (descriptor) => (
    gpu.raise('[PipelineLayout] refused'),
    made(descriptor)
  )
  const answer = await validatedOrWhy(device, async () => {
    const module = device.createShaderModule({ code: '' })
    await Promise.resolve()
    return buildComputeStage(device, [], module, 'main')
  })
  assert.deepEqual(answer, { refused: '[PipelineLayout] refused' })
  assert.deepEqual(uncaptured, [])
  assert.equal(gpu.scopes.length, 0)
})
