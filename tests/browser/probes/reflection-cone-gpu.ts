import { ggxIntegral } from '../../../packages/sdk-browser/src/reflections/ggxIntegral.fixture.ts';
// Numeric ray/cone diagnosis and real forward pipeline validation; no image/timing proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONE_DIAGNOSTIC_WGSL } from './reflection-cone-shader.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { blendShader } from '../../../packages/sdk-browser/src/webgpu/blend/shader.ts';

const BLEND_SHADER = blendShader();

async function diagnose({ compute, forward }: { compute: string; forward: string }) {
  const opened = await globalThis.openGpuDevice();
  if (!opened) throw new Error('WebGPU unavailable');
  const { device, errors } = opened;
  const blend = await opened.compile(forward);
  errors.push(...blend.compilation);
  if (!blend.compilation.length) {
    try {
      await device.createRenderPipelineAsync({
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
      });
    } catch (error) {
      errors.push(String(error));
    }
  }
  const made = await opened.compile(compute);
  errors.push(...made.compilation);
  if (errors.length) {
    await opened.fermer();
    return { values: [], bits: [], controls: [], errors };
  }
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: made.module, entryPoint: 'main' },
  });
  const bytes = 75 * 16;
  const output = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const inputs = device.createBuffer({
    size: bytes * 2,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const controls = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const data = new Float32Array(75 * 8);
  for (let row = 0; row < 75; row++) {
    const position =
      row === 3
        ? [0.9, 0, 0.2]
        : row === 4
          ? [-0.8, 0, 0.6]
          : row === 5
            ? [0.8, 0, 0.2]
            : [-0.8, 0, 0.2];
    data.set([...position, 0.5, row === 5 ? -0.8 : 0.8, 0, 0.6, 0], row * 8);
  }
  device.queue.writeBuffer(inputs, 0, data);
  const readback = device.createBuffer({
    size: bytes * 2,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: output } },
      { binding: 1, resource: { buffer: inputs } },
      { binding: 2, resource: { buffer: controls } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(75);
  pass.end();
  encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
  encoder.copyBufferToBuffer(controls, 0, readback, bytes, bytes);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mapped = readback.getMappedRange();
  const values = Array.from(new Float32Array(mapped, 0, bytes / 4));
  const bits = Array.from(new Uint32Array(mapped, 0, bytes / 4));
  const controlWords = Array.from(new Uint32Array(mapped, bytes, bytes / 4));
  readback.unmap();
  readback.destroy();
  output.destroy();
  inputs.destroy();
  controls.destroy();
  await opened.fermer();
  return { values, bits, controls: controlWords, errors };
}

if (import.meta.main)
  test('forward cone uses its receiver, distance and roughness, with deterministic energy and misses', async () => {
    const result = await dansPageWebgpu(diagnose, {
      compute: CONE_DIAGNOSTIC_WGSL,
      forward: BLEND_SHADER,
    });
    assert.deepEqual(result.errors, []);
    for (let row = 0; row < 75; row++)
      assert.deepEqual(
        result.controls.slice(row * 4, row * 4 + 4),
        [row, 75, 1, 1],
        `dispatch ${row}`,
      );
    const at = (row: number) => result.values.slice(row * 4, row * 4 + 4);
    assert.equal(at(0)[3], 1, 'baseline mirror hits the analytic plane');
    assert.deepEqual(at(1), at(2), 'no changing frame seed on transparent receivers');
    for (const row of [1, 4, 5]) {
      assert.ok(
        Math.abs(at(row)[0] - 1) < 1e-5,
        `constant white radiance keeps its energy: ${JSON.stringify(result.values)}`,
      );
      assert.ok(Math.abs(at(row)[3] - 1) < 1e-5, 'fully covered cone');
    }
    assert.deepEqual(at(3), [0, 0, 0, 0], 'off-screen exit preserves the miss contract');
    assert.ok(at(1)[2] > at(4)[2], 'farther plane requires a larger projected footprint');
    assert.notEqual(
      at(1)[1],
      at(5)[1],
      'each layer traces its own position and reflection direction',
    );
    assert.ok(at(6)[0] < at(6)[1] && at(6)[1] < at(6)[2]);
    assert.ok(Math.abs(at(6)[2] - 1) < 1e-4, 'roughness-one weighted median is 45 degrees');
    for (const [index, rough] of [0.1, 0.5, 0.8, 1].entries()) {
      const k = rough ** 4,
        end = 1 / (1 + k),
        mass = ggxIntegral(k, end);
      const expected = [
        1,
        ggxIntegral(k, end, 2) / mass,
        ((3 * ggxIntegral(k, end, 3)) / mass - 1) / 2,
      ];
      expected.forEach((value, band) =>
        assert.ok(
          Math.abs(at(7 + index)[band] - value) < 2e-4,
          `GGX SH band ${band} at ${rough}: ${at(7 + index)[band]} vs ${value}`,
        ),
      );
    }
    assert.ok(result.values.every(Number.isFinite), 'every output is finite');
    const baselineBits = result.bits.slice(4, 8);
    for (let row = 11; row < 75; row++)
      assert.deepEqual(
        result.bits.slice(row * 4, row * 4 + 4),
        baselineBits,
        `independent replay ${row - 11}`,
      );
  });
