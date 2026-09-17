import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { HIZ_SHADER, packHizPyramid } from '../../packages/sdk-browser/gpuHiz.ts';

const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
const width = 33,
  height = 19;
const makeCase = (hole) => {
  const depth = Array.from({ length: height }, () => Array(width).fill(0.2));
  if (hole) depth[18][32] = 1;
  const packed = packHizPyramid(depth);
  return {
    name: hole ? 'edge background hole' : 'fully covered',
    data: [...packed.data],
    size: packed.data.byteLength,
    expected: hole ? 0 : 1,
  };
};
const cases = [
  makeCase(false),
  makeCase(true),
  { ...makeCase(false), name: 'near-plane crossing', clipsNear: true, expected: 0 },
];
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>WebGeometry Hi-Z GPU check</title>');
});
await new Promise((ready, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', ready);
});
const address = server.address();
if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  version: 1,
  startedAt: new Date().toISOString(),
  shader: 'packages/sdk-browser/gpuHiz.ts',
  shaderSha256: createHash('sha256').update(HIZ_SHADER).digest('hex'),
  width,
  height,
  adapter: null,
  results: [],
  errors: [],
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const result = await page.evaluate(
    async ({ shader, cases }) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return { unavailable: 'No WebGPU adapter' };
      const adapterInfo = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      };
      const device = await adapter.requestDevice();
      const errors = [];
      device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
      const module = device.createShaderModule({ code: shader });
      const info = await module.getCompilationInfo();
      const compilationErrors = info.messages
        .filter((message) => message.type === 'error')
        .map((message) => message.message);
      if (compilationErrors.length) return { adapter: adapterInfo, compilationErrors, errors };
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'unfilterable-float' },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 },
          },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'testHiz' },
      });
      const texture = device.createTexture({
        size: { width: 1, height: 1 },
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
      const uniform = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bounds = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const flags = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const readback = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const uni = new Uint32Array(64);
      uni[2] = 1;
      device.queue.writeBuffer(uniform, 0, uni);
      const descriptor = new ArrayBuffer(32),
        i32 = new Int32Array(descriptor),
        f32 = new Float32Array(descriptor),
        u32 = new Uint32Array(descriptor);
      i32.set([0, 0, 8, 4]);
      f32[4] = 0.8;
      u32[6] = 797;
      u32[7] = 9;
      const results = [];
      for (const sample of cases) {
        u32[5] = sample.clipsNear ? 1 : 0;
        device.queue.writeBuffer(bounds, 0, descriptor);
        const pyramid = device.createBuffer({
          size: sample.size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(pyramid, 0, new Float32Array(sample.data));
        const group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: pyramid } },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: { buffer: uniform, size: 256 } },
            { binding: 3, resource: { buffer: bounds } },
            { binding: 4, resource: { buffer: flags } },
          ],
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group, [0]);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(flags, 0, readback, 0, 4);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const flag = new Uint32Array(readback.getMappedRange().slice(0))[0];
        readback.unmap();
        results.push({ name: sample.name, expected: sample.expected, flag });
        pyramid.destroy();
      }
      await device.queue.onSubmittedWorkDone();
      texture.destroy();
      uniform.destroy();
      bounds.destroy();
      flags.destroy();
      readback.destroy();
      device.destroy();
      return { adapter: adapterInfo, results, errors };
    },
    { shader: HIZ_SHADER, cases },
  );
  Object.assign(report, result);
  assert.ok(!result.unavailable, result.unavailable);
  assert.deepEqual(result.compilationErrors ?? [], []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.results?.map((item) => item.flag),
    cases.map((item) => item.expected),
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  const out = resolve(process.env.HIZ_RESULT ?? 'benchmark-runs/webgpu-hiz/result.json');
  await mkdir(resolve(out, '..'), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify({ status: report.status, adapter: report.adapter, results: report.results }),
);
