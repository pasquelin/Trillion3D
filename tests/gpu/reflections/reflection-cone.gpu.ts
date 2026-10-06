// The reflection cone on the GPU: the shipped screen walk, cone and probe bands traced through an
// analytic plane (`coneScene.ts`), and the blend program — which reads the same cone — built into
// its forward pipeline.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/reflection-cone.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ggxIntegral } from '../../../packages/sdk-browser/src/reflections/ggxIntegral.fixture.ts'
import { BLEND_SHADER } from '../../../packages/sdk-browser/src/gpu/core/shaderTexts.fixture.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { CONE_ROWS, CONE_SCENE_WGSL, coneRows } from './coneScene.ts'

type Input = { compute: string; forward: string; rows: Float32Array<ArrayBuffer>; count: number }

async function trace({ compute, forward, rows, count }: Input) {
  const opened = await openGpuDevice()
  if (!opened) throw new Error('no WebGPU adapter')
  const { device, errors } = opened
  const blend = await opened.compile(forward)
  errors.push(...blend.compilation)
  if (!blend.compilation.length)
    await device
      .createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: blend.module, entryPoint: 'vs' },
        fragment: {
          module: blend.module,
          entryPoint: 'fs',
          targets: [{ format: 'rgba16float' }, { format: 'r32uint' }, { format: 'rg8unorm' }],
        },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: false,
          depthCompare: 'greater-equal',
        },
      })
      .catch((error: unknown) => errors.push(String(error)))
  const made = await opened.compile(compute)
  errors.push(...made.compilation)
  if (errors.length) {
    await opened.fermer()
    return { values: [], bits: [], controls: [], errors }
  }
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: made.module, entryPoint: 'main' },
  })
  const bytes = count * 16
  const storage = (size: number, usage: number) =>
    device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | usage })
  const output = storage(bytes, GPUBufferUsage.COPY_SRC)
  const inputs = storage(bytes * 2, GPUBufferUsage.COPY_DST)
  const controls = storage(bytes, GPUBufferUsage.COPY_SRC)
  device.queue.writeBuffer(inputs, 0, rows)
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [output, inputs, controls].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    }),
  )
  pass.dispatchWorkgroups(count)
  pass.end()
  device.queue.submit([encoder.finish()])
  const words = (await readGpuBuffer(device, output, bytes))!
  const values = Array.from(new Float32Array(words.buffer))
  const bits = Array.from(words)
  const controlWords = Array.from((await readGpuBuffer(device, controls, bytes))!)
  for (const buffer of [output, inputs, controls]) buffer.destroy()
  await opened.fermer()
  return { values, bits, controls: controlWords, errors }
}

test('the cone reads its receiver, distance and roughness, keeps its energy and its misses', async () => {
  const result = await runOnDawn(trace, {
    compute: CONE_SCENE_WGSL,
    forward: BLEND_SHADER,
    rows: coneRows(),
    count: CONE_ROWS,
  })
  assert.deepEqual(result.errors, [])
  for (let row = 0; row < CONE_ROWS; row++)
    assert.deepEqual(
      result.controls.slice(row * 4, row * 4 + 4),
      [row, CONE_ROWS, 1, 1],
      `dispatch ${row}`,
    )
  const at = (row: number) => result.values.slice(row * 4, row * 4 + 4)
  assert.equal(at(0)[3], 1, 'the mirror walk hits the analytic plane')
  assert.deepEqual(at(1), at(2), 'no frame seed changes a transparent receiver')
  for (const row of [1, 4, 5]) {
    assert.ok(Math.abs(at(row)[0] - 1) < 1e-5, `row ${row}: white radiance keeps its energy`)
    assert.ok(Math.abs(at(row)[3] - 1) < 1e-5, `row ${row}: the cone is fully covered`)
  }
  assert.deepEqual(at(3), [0, 0, 0, 0], 'a ray leaving the view is a miss')
  assert.ok(at(1)[2] > at(4)[2], 'a farther plane spans a larger projected footprint')
  assert.notEqual(at(1)[1], at(5)[1], 'each receiver traces its own position and direction')
  assert.ok(at(6)[0] < at(6)[1] && at(6)[1] < at(6)[2], 'the aperture grows with roughness')
  assert.ok(Math.abs(at(6)[2] - 1) < 1e-4, 'at roughness one the weighted median is 45 degrees')
  for (const [index, rough] of [0.1, 0.5, 0.8, 1].entries()) {
    const k = rough ** 4,
      end = 1 / (1 + k),
      mass = ggxIntegral(k, end)
    const expected = [
      1,
      ggxIntegral(k, end, 2) / mass,
      ((3 * ggxIntegral(k, end, 3)) / mass - 1) / 2,
    ]
    expected.forEach((value, band) =>
      assert.ok(
        Math.abs(at(7 + index)[band] - value) < 2e-4,
        `GGX band ${band} at roughness ${rough}: ${at(7 + index)[band]} against ${value}`,
      ),
    )
  }
  assert.ok(result.values.every(Number.isFinite), 'every output is finite')
  for (let row = 11; row < CONE_ROWS; row++)
    assert.deepEqual(
      result.bits.slice(row * 4, row * 4 + 4),
      result.bits.slice(4, 8),
      `replay ${row - 11} traces row 1's bits`,
    )
})
