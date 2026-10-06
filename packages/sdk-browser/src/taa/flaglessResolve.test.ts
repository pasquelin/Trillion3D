import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { TAA_BINDINGS } from './bindingsWgsl.ts'

// OMB-11: both resolves compile with the pass; a frame handed no flags draws the flagless one, on
// a group and layout without the flags, and compiles nothing.
test('a frame with no as-is pixel resolves flagless, and switching compiles no pipeline', async () => {
  const { device, renderPipelines } = fakeDevice()
  const modules = () => renderPipelines.map(({ fragment }) => fragment!.module.label)
  const temporal = await createTemporalAntialiasing(device, [])
  // The ones that read no reactive value compile after them, off the preparation.
  assert.deepEqual(modules().slice(0, 3), [
    'TAA_RESOLVE',
    'TAA_RESOLVE_FLAGLESS',
    'TAA_RESOLVE_BLENDED',
  ])
  const prepared = modules().length
  temporal.resize(8, 4)
  const drawn: Array<{ module?: string; bindings: number[]; layout: number[] }> = []
  const pass = {
    setPipeline: (pipeline: GPURenderPipelineDescriptor) =>
      void drawn.push({
        module: pipeline.fragment!.module.label,
        bindings: [],
        layout: [],
      }),
    setBindGroup(_slot: number, group: GPUBindGroupDescriptor) {
      const last = drawn[drawn.length - 1]
      last.bindings = [...group.entries].map((entry) => entry.binding)
      const { entries } = group.layout as unknown as GPUBindGroupLayoutDescriptor
      last.layout = [...entries].map((entry) => entry.binding)
    },
    draw() {},
    end() {},
  }
  const encoder = {
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer
  const inputs = {
    current: view(),
    depth: view(),
    ids: view(),
    pages: buffer,
    motion: buffer,
    pool: buffer,
    positions: buffer,
    uvs: buffer,
  }
  // Handed a reactive value, a frame draws the resolve that reads it, whether or not the one that
  // reads none has compiled yet.
  const reading = { ...inputs, reactive: view() }
  temporal.encode(encoder, reading)
  temporal.encode(encoder, { ...reading, flags: view() })
  temporal.encode(encoder, { ...reading, share: view() })
  assert.equal(modules().length, prepared, 'no pipeline compiled in a frame')
  // The share history is the share target every resolve binds: the flags alone are the flagless'
  // difference.
  const flags = TAA_BINDINGS.flags
  assert.equal(drawn[0].module, 'TAA_RESOLVE_FLAGLESS')
  assert.ok(!drawn[0].bindings.includes(flags), 'the flagless group binds no flags')
  assert.ok(!drawn[0].layout.includes(flags), 'nor does its layout declare them')
  assert.equal(drawn[1].module, 'TAA_RESOLVE')
  assert.ok(drawn[1].bindings.includes(flags))
  assert.equal(drawn[2].module, 'TAA_RESOLVE_BLENDED')
  assert.ok(drawn[2].bindings.includes(flags))
  // Every resolve reads the share target and gathers through the texel sampler.
  for (const { bindings, layout } of drawn)
    for (const binding of [TAA_BINDINGS.shareHistory, TAA_BINDINGS.texelSampler])
      assert.ok(bindings.includes(binding) && layout.includes(binding), `binding ${binding}`)
  // Off the preparation, the flagless and as-is resolves that read no reactive value compile; a
  // frame handed none then draws them, one handed one the reading resolve.
  do await new Promise((done) => setImmediate(done))
  while (modules().length < 5)
  temporal.encode(encoder, inputs)
  temporal.encode(encoder, { ...inputs, flags: view() })
  temporal.encode(encoder, { ...inputs, reactive: view() })
  assert.deepEqual(
    drawn.slice(3).map(({ module }) => module),
    ['TAA_RESOLVE_FLAGLESS_UNREACTIVE', 'TAA_RESOLVE_UNREACTIVE', 'TAA_RESOLVE_FLAGLESS'],
  )
  temporal.dispose()
})
