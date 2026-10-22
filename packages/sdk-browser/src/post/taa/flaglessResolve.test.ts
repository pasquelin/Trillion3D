import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { TAA_BINDINGS } from './bindingsWgsl.ts'

// The resolves compile with the pass, the analysis's programs after them — five compute passes and
// the spatial anti-aliaser's draw —; a frame handed no flags draws the flagless one, on a group and
// layout without the flags, and compiles nothing.
test('a frame with no as-is pixel resolves flagless, and switching compiles no pipeline', async () => {
  const { device, renderPipelines, computePipelines, draws: all } = fakeDevice()
  // The resolves' draws, past the spatial anti-aliaser's before each.
  const resolves = () =>
    all.filter(({ pipeline }) => pipeline.fragment!.module.label.startsWith('TAA_RESOLVE'))
  const modules = () => [
    ...renderPipelines.map(({ fragment }) => fragment!.module.label),
    ...computePipelines.map(({ compute }) => compute.module.label),
  ]
  const temporal = await createTemporalAntialiasing(device, createVelocity(device, []))
  assert.deepEqual(modules(), [
    'TAA_RESOLVE',
    'TAA_RESOLVE_FLAGLESS',
    'TAA_RESOLVE_BLENDED',
    'TAA_SPATIAL_AA',
    'TAA_VELOCITY',
    'TAA_REPROJECT',
    'TAA_THIN_GEOMETRY',
    'TAA_FLICKER',
    'TAA_HELD_MEASURE',
    'TAA_REJECTION',
  ])
  const prepared = modules().length
  temporal.resize(8, 4, 8, 4)
  const encoder = device.createCommandEncoder()
  /** Each resolve drawn: its module, the bindings its group binds and those its layout declares. */
  const drawn = () =>
    resolves().map(({ pipeline, groups: [group] }) => {
      const { entries, layout } = group as GPUBindGroupDescriptor
      return {
        module: pipeline.fragment!.module.label,
        bindings: [...entries].map((entry) => entry.binding),
        layout: [...(layout as unknown as GPUBindGroupLayoutDescriptor).entries].map(
          (entry) => entry.binding,
        ),
      }
    })
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
  const reading = { ...inputs, reactive: view() }
  temporal.encode(encoder, reading, [4, 2])
  temporal.encode(encoder, { ...reading, flags: view() }, [4, 2])
  temporal.encode(encoder, { ...reading, share: view() }, [4, 2])
  assert.equal(modules().length, prepared, 'no pipeline compiled in a frame')
  // The share history is the share target every resolve binds: the flags alone are the flagless'
  // difference.
  const flags = TAA_BINDINGS.flags,
    first = drawn()
  assert.equal(first[0].module, 'TAA_RESOLVE_FLAGLESS')
  assert.ok(!first[0].bindings.includes(flags), 'the flagless group binds no flags')
  assert.ok(!first[0].layout.includes(flags), 'nor does its layout declare them')
  assert.equal(first[1].module, 'TAA_RESOLVE')
  assert.ok(first[1].bindings.includes(flags))
  assert.equal(first[2].module, 'TAA_RESOLVE_BLENDED')
  assert.ok(first[2].bindings.includes(flags))
  // Every resolve reads the share target, the history the transparents give up, and the analysis:
  // the reprojection vectors, the shading rejection and the spatial anti-aliaser.
  for (const { bindings, layout } of first)
    for (const binding of [
      TAA_BINDINGS.shareHistory,
      TAA_BINDINGS.givenUp,
      TAA_BINDINGS.vectors,
      TAA_BINDINGS.rejection,
      TAA_BINDINGS.antiAliasing,
    ])
      assert.ok(bindings.includes(binding) && layout.includes(binding), `binding ${binding}`)
  // A frame handed no reactive value draws the same resolves, the zero texel read in its place.
  temporal.encode(encoder, inputs, [4, 2])
  temporal.encode(encoder, { ...inputs, flags: view() }, [4, 2])
  assert.deepEqual(
    drawn()
      .slice(3)
      .map(({ module }) => module),
    ['TAA_RESOLVE_FLAGLESS', 'TAA_RESOLVE'],
  )
  assert.equal(modules().length, prepared, 'nor in a frame without a reactive value')
  temporal.dispose()
})
