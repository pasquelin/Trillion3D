import test, { type TestContext } from 'node:test'
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

/** The validation error class a browser has and the fake device does not: an instance is what a validation scope holds. */
class FakeValidationError extends Error {}

/** Sets the fake class for the test, put back as it was when the test ends. */
function withFakeValidationError(t: TestContext) {
  const had = Object.hasOwn(globalThis, 'GPUValidationError')
  const real = (globalThis as { GPUValidationError?: unknown }).GPUValidationError
  Object.assign(globalThis, { GPUValidationError: FakeValidationError })
  t.after(() => {
    if (had) Object.assign(globalThis, { GPUValidationError: real })
    else delete (globalThis as { GPUValidationError?: unknown }).GPUValidationError
  })
}

test("a resource build that rejects while the scope holds a validation error is refused with the scope's own error, not mapped to a pipeline", async (t) => {
  withFakeValidationError(t)
  const gpu = fakeDevice()
  const refusing = validationScope(gpu.device, async () => {
    gpu.raise('[BindGroupLayout] refused', new FakeValidationError('[BindGroupLayout] refused'))
    await Promise.resolve()
    throw new Error('the build failed')
  })
  await assert.rejects(refusing, (error: Error) => {
    assert.ok(error instanceof FakeValidationError)
    assert.ok(!(error instanceof GPUPipelineError))
    assert.equal(error.message, '[BindGroupLayout] refused')
    return true
  })
  assert.deepEqual(
    await validatedOrWhy(gpu.device, async () => {
      gpu.raise('[BindGroupLayout] refused', new FakeValidationError('[BindGroupLayout] refused'))
      throw new Error('the build failed')
    }),
    { refused: '[BindGroupLayout] refused' },
  )
  assert.equal(gpu.scopes.length, 0)
})

test('a bind group layout the device refuses is a validation error of the scope, a pipeline is the only one mapped', async (t) => {
  withFakeValidationError(t)
  const gpu = fakeDevice()
  const create = gpu.device.createBindGroupLayout.bind(gpu.device)
  gpu.device.createBindGroupLayout = (descriptor) => {
    gpu.raise('[BindGroupLayout] refused', new FakeValidationError('[BindGroupLayout] refused'))
    return create(descriptor)
  }
  const { value, error } = await validationScope(gpu.device, () =>
    gpu.device.createBindGroupLayout({ entries: [] }),
  )
  assert.ok(value)
  assert.ok(error instanceof FakeValidationError)
  await assert.rejects(
    madeChecked(
      gpu.device,
      () => gpu.device.createBindGroupLayout({ entries: [] }),
      async () => 'used',
    ),
    (refusal: unknown) => refusal instanceof GPUPipelineError && refusal.reason === 'validation',
  )
})

test('a pipeline refusal is built without the host class: named as it is, with its reason', async (t) => {
  withFakeValidationError(t)
  const gpu = fakeDevice()
  const real = globalThis.GPUPipelineError
  delete (globalThis as { GPUPipelineError?: unknown }).GPUPipelineError
  try {
    await assert.rejects(
      madeChecked(
        gpu.device,
        () => gpu.raise('[Pipeline] refused'),
        async () => 'used',
      ),
      (error: Error & { reason?: string }) => {
        assert.equal(error.name, 'GPUPipelineError')
        assert.equal(error.reason, 'validation')
        assert.equal(error.message, '[Pipeline] refused')
        return true
      },
    )
    assert.deepEqual(
      await validatedOrWhy(gpu.device, async () => {
        gpu.raise('[Pipeline] refused', new FakeValidationError('[Pipeline] refused'))
        throw new Error('the build failed')
      }),
      { refused: '[Pipeline] refused' },
    )
  } finally {
    globalThis.GPUPipelineError = real
  }
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

test('the stages of one module share one pipeline layout, made in one set of three scopes', async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  let opened = 0
  const push = device.pushErrorScope.bind(device)
  device.pushErrorScope = (filter) => (opened++, push(filter))
  const module = device.createShaderModule({ code: '' })
  const stages = await buildComputeStages(device, [], module, ['a', 'b', 'c'])
  assert.deepEqual(Object.keys(stages), ['a', 'b', 'c'])
  assert.equal(gpu.pipelineLayouts.length, 1)
  assert.equal(
    opened,
    3,
    'one validation scope inside one out-of-memory scope inside one internal scope, for the three stages',
  )
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

test('a resource refused by its out-of-memory scope keeps its own error type, only a pipeline is mapped to GPUPipelineError', async () => {
  const gpu = fakeDevice()
  const refusing = validationScope(
    gpu.device,
    async () => {
      gpu.raise('[Device] out of memory', new GPUOutOfMemoryError('[Device] out of memory'))
      throw new Error('the build failed')
    },
    'out-of-memory',
  )
  await assert.rejects(refusing, (error: unknown) => {
    assert.ok(error instanceof GPUOutOfMemoryError)
    assert.ok(!(error instanceof GPUPipelineError))
    assert.equal(error.message, '[Device] out of memory')
    return true
  })
  assert.deepEqual(
    await validatedOrWhy(
      gpu.device,
      async () => {
        gpu.raise('[Device] out of memory', new GPUOutOfMemoryError('[Device] out of memory'))
        throw new Error('the build failed')
      },
      'out-of-memory',
    ),
    { refused: '[Device] out of memory' },
    'still a refusal for the caller that asks why',
  )
  assert.equal(gpu.scopes.length, 0)
})

test('a scope refusal is for good only where the validation scope caught it', async () => {
  const gpu = fakeDevice()
  const reasonOf = async (error: object) => {
    try {
      await madeChecked(
        gpu.device,
        () => gpu.raise('[Scope] refused', error),
        async () => 'used',
      )
    } catch (error) {
      return (error as GPUPipelineError).reason
    }
  }
  assert.equal(await reasonOf({ message: 'a validation error' }), 'validation')
  assert.equal(
    await reasonOf(new GPUOutOfMemoryError('out of memory')),
    'internal',
    'tried again with the backoff',
  )
  assert.equal(
    await reasonOf(new GPUInternalError('implementation failure')),
    'internal',
    'a pipeline the implementation fails to make is tried again too',
  )
  assert.equal(gpu.scopes.length, 0)
})

test('a pop the device rejects hides no error another scope captured, and is thrown when none did', async () => {
  const gpu = fakeDevice()
  const pop = gpu.device.popErrorScope.bind(gpu.device)
  let failFirst = true
  gpu.device.popErrorScope = () => {
    const popped = pop()
    if (!failFirst) return popped
    failFirst = false
    return popped.then(() => Promise.reject(new DOMException('NO', 'OperationError')))
  }
  await assert.rejects(
    madeChecked(
      gpu.device,
      () => gpu.raise('[Memory] refused', new GPUOutOfMemoryError('out of memory')),
      async () => 'used',
    ),
    (error: Error) => {
      assert.ok(error instanceof GPUPipelineError)
      assert.equal(error.message, 'out of memory', 'the captured error, not the rejected pop')
      assert.equal(error.reason, 'internal')
      return true
    },
  )
  failFirst = true
  await assert.rejects(
    madeChecked(
      gpu.device,
      () => 'made',
      async () => 'used',
    ),
    (error: unknown) => error instanceof DOMException,
  )
  assert.equal(gpu.scopes.length, 0, 'all three scopes were popped')
})

test('an error the internal scope caught is a refusal for the caller that asks why, as the out-of-memory one is', async () => {
  const gpu = fakeDevice()
  assert.deepEqual(
    await validatedOrWhy(
      gpu.device,
      async () => {
        gpu.raise('[Device] implementation failure', new GPUInternalError('implementation failure'))
        throw new Error('the build failed')
      },
      'internal',
    ),
    { refused: 'implementation failure' },
  )
  assert.equal(gpu.scopes.length, 0)
})

test('a host without the error classes classifies a refusal without throwing', async (t) => {
  const gpu = fakeDevice()
  for (const name of ['GPUValidationError', 'GPUOutOfMemoryError', 'GPUInternalError'] as const) {
    const real = (globalThis as Record<string, unknown>)[name]
    t.after(() => Object.assign(globalThis, { [name]: real }))
    delete (globalThis as Record<string, unknown>)[name]
  }
  await assert.rejects(
    validatedOrWhy(gpu.device, async () => {
      throw new Error('the build failed')
    }),
    /the build failed/,
  )
  assert.equal(gpu.scopes.length, 0)
})
