import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createWebgpuRipples } from './webgpu.ts';

function recorder() {
  const calls: { kind: string; offset?: number; instances?: number }[] = [];
  const encoder = {
    beginComputePass() {
      const call = { kind: 'solve', offset: 0 };
      calls.push(call);
      return {
        setPipeline() {},
        setBindGroup(_n: number, _group: unknown, offsets: number[]) {
          call.offset = offsets[0];
        },
        dispatchWorkgroups() {},
        end() {},
      };
    },
    beginRenderPass() {
      const call = { kind: 'splat', instances: 0 };
      calls.push(call);
      return {
        setPipeline() {},
        setBindGroup() {},
        setVertexBuffer() {},
        draw(_vertices: number, instances: number) {
          call.instances = instances;
        },
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, calls };
}

test('ripple impulses survive frames without ticks and are not injected again on catch-up', async () => {
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } });
  const runtime = await createWebgpuRipples(gpu.device, { resolution: 256, rate: 30 });
  const { encoder, calls } = recorder();
  runtime.step(0, encoder, { camera: [0, 0], splats: [[0, 0, 1, 0.01]] });
  assert.deepEqual(calls, [{ kind: 'splat', instances: 1 }]);
  runtime.step(2 / 30, encoder);
  assert.deepEqual(
    calls.map((c) => c.kind),
    ['splat', 'solve', 'solve'],
  );
  runtime.dispose();
  runtime.dispose();
  assert.equal(gpu.destroyed.length, 5, 'two textures and three buffers released exactly once');
});

test('recenter and catch-up retain distinct uniform values until the external encoder submits', async () => {
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } });
  const runtime = await createWebgpuRipples(gpu.device, { resolution: 512, rate: 30 });
  const { encoder, calls } = recorder();
  runtime.step(0, encoder, { camera: [0, 0], splats: [] });
  runtime.step(10, encoder, { camera: [0.125, 0], splats: [] });
  assert.deepEqual(
    calls.map((c) => c.offset),
    [0, 256, 512, 768, 1024],
  );
  const uniforms = gpu.writes.slice(1).map((write) => new Uint8Array(written(write)).buffer);
  assert.equal(new Float32Array(uniforms[0])[0], 0);
  assert.deepEqual([...new Int32Array(uniforms[0]).slice(4, 6)], [1, 0]);
  for (const words of uniforms.slice(1)) {
    assert.equal(new Float32Array(words)[0], Math.fround(1 / 30));
    assert.deepEqual([...new Int32Array(words).slice(4, 6)], [0, 0]);
  }
  runtime.dispose();
});
