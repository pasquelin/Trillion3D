import { taaInputs, taaShape, taaSlices } from './frame.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { TAA_BINDINGS } from './bindingsWgsl.ts'

/** A pass made on a fake device, its updates and analysis programs compiled and its targets made
 *  at 8 × 4: the modules compiled before the targets and after them (the history's resolve is asked
 *  with the targets), those compiled so far, the history updates dispatched with the bindings their
 *  group binds and their layout declares, and its inputs. */
async function preparedPass() {
  // A frame timed per pass: each step of the analysis, the update and the resolve a pass of its own.
  const { device, computePipelines, computePasses } = fakeDevice({ timed: true, timedApart: true })
  const modules = () => computePipelines.map(({ compute }) => compute.module.label)
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  const compiled = modules()
  temporal.resize(taaShape(8, 4), 8, 4)
  // The programs the targets ask compile off the frame: let them settle.
  await new Promise((resolve) => setTimeout(resolve))
  const asked = modules()
  const view = () => ({}) as GPUTextureView
  const inputs = taaInputs()
  /** Each update dispatched: its module, the bindings its group binds and those its layout declares. */
  const dispatched = () =>
    computePasses.flatMap(({ commands }) => {
      const [[pipeline]] = [...commandArgs(commands, 'setPipeline'), [undefined]] as [
        { entryPoint: string; module: { label: string } },
      ][]
      if (pipeline?.entryPoint !== 'resolve') return []
      const [[, group]] = commandArgs(commands, 'setBindGroup') as [
        [number, GPUBindGroupDescriptor],
      ]
      return [
        {
          module: pipeline.module.label,
          bindings: [...group.entries].map((entry) => entry.binding),
          layout: [...(group.layout as unknown as GPUBindGroupLayoutDescriptor).entries].map(
            (entry) => entry.binding,
          ),
        },
      ]
    })
  return { device, temporal, modules, compiled, asked, inputs, view, dispatched }
}

// The updates compile with the pass — the one of a history of the display's size, which writes the
// half-size image —, the analysis's programs after it; the reprojection and the shading rejection
// of a history that resurrects are left until a history that resurrects asks them. One update for
// every frame: the as-is pixels of a debug view are composed after the temporal pass, so no update
// reads a flag or a share (it had three kinds: as-is, flagless and blended).
test('every frame dispatches the one update, which reads no flag, and compiles no pipeline', async () => {
  const { device, temporal, modules, compiled, asked, inputs, view, dispatched } =
    await preparedPass()
  assert.deepEqual(compiled, [
    'TAA_UPDATE false true plain',
    // Asked with the pass, as every permutation of a global shader is: the history of a larger size, which writes no half-size image, compiles nothing when it is made.
    'TAA_UPDATE false false plain',
    'TAA_VELOCITY',
    'TAA_REPROJECT',
    'TAA_REJECT_SHADING',
    'TAA_THIN_GEOMETRY',
    'TAA_SPATIAL_AA',
    // The thin geometry's weight relaxation and the measures taken before the translucency, passes
    // of their own: the measures read the scene before the layers are composed onto it.
    'TAA_THIN_RELAXATION',
    'TAA_MEASURE_LUMA',
    'TAA_MEASURE_COVERAGE',
  ])
  assert.deepEqual(
    asked.slice(compiled.length),
    [
      'TAA_resolveHistory',
      'TAA_resolveHistory',
      'TAA_resolveLayers',
      'TAA_REPROJECT',
      'TAA_REJECT_SHADING',
    ],
    'the targets ask the resolve — both colour passes and the layers — and the reprojection and the shading rejection of a history that resurrects (the resurrected guide and field were folded into them)',
  )
  const encoder = device.createCommandEncoder()
  temporal.encode(encoder, { ...inputs, responsive: view() }, [4, 2], taaSlices())
  temporal.encode(encoder, inputs, [4, 2], taaSlices())
  assert.deepEqual(modules(), asked, 'no pipeline compiled in a frame')
  const first = dispatched()
  assert.deepEqual(
    first.map(({ module }) => module),
    ['TAA_UPDATE false false plain', 'TAA_UPDATE false false plain'],
    'with or without the responsiveness, the same update',
  )
  // Every update reads the validity and the analysis: the reprojection vectors, the shading
  // rejection and the spatial anti-aliaser's offsets, and stores the frame it writes: its colour
  // and its validity.
  for (const { bindings, layout } of first)
    for (const binding of [
      TAA_BINDINGS.validityHistory,
      TAA_BINDINGS.vectors,
      TAA_BINDINGS.rejection,
      TAA_BINDINGS.antiAliasing,
      TAA_BINDINGS.historyOut,
      TAA_BINDINGS.validityOut,
    ])
      assert.ok(bindings.includes(binding) && layout.includes(binding), `binding ${binding}`)
  temporal.dispose()
})
