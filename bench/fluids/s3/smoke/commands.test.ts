import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { smokeCamera } from '../inputs.ts';
import { createSmoke } from './index.ts';
import { SMOKE_PASSES, smokePlan, type SmokeSpec } from './plan.ts';

const spec: SmokeSpec = {
  grid: 32,
  iterations: 10,
  width: 101,
  height: 51,
  coverage: 0.25,
  format: 'bgra8unorm',
  maxSteps: 128,
};
const gpu = () =>
  fakeDevice({ limits: { maxTextureDimension2D: 8192, maxTextureDimension3D: 256 } });
function recording() {
  const passes: {
    label?: string;
    groups: GPUBindGroup[];
    dispatches: number[][];
    draws: number[];
  }[] = [];
  const begin = ({ label }: { label?: string }) => {
    const record = {
      label,
      groups: [] as GPUBindGroup[],
      dispatches: [] as number[][],
      draws: [] as number[],
    };
    passes.push(record);
    return {
      setPipeline() {},
      setBindGroup(_slot: number, group: GPUBindGroup) {
        record.groups.push(group);
      },
      dispatchWorkgroups(...dimensions: number[]) {
        record.dispatches.push(dimensions);
      },
      setScissorRect() {},
      draw(vertices: number) {
        record.draws.push(vertices);
      },
      end() {},
    };
  };
  return {
    passes,
    encoder: { beginComputePass: begin, beginRenderPass: begin } as unknown as GPUCommandEncoder,
  };
}
for (const iterations of [10, 20] as const)
  test(`smoke ${iterations} pressure dispatches alternate without aliasing`, async () => {
    const fake = gpu(),
      runtime = await createSmoke(fake.device, { ...spec, iterations });
    const commands = recording();
    runtime.encode(commands.encoder, {
      ...smokeCamera(),
      dt: 1 / 30,
      outputView: {} as GPUTextureView,
    });
    assert.deepEqual(
      commands.passes.map((p) => p.label),
      SMOKE_PASSES,
    );
    assert.equal(commands.passes[2].dispatches.length, iterations);
    for (const pass of commands.passes.slice(0, 4))
      for (const dimensions of pass.dispatches) assert.deepEqual(dimensions, [8, 8, 8]);
    const pressure = commands.passes[2].groups;
    assert.notEqual(pressure[0], pressure[1]);
    pressure.forEach((group, index) => assert.equal(group, pressure[index % 2]));
    const bindings = (index: number) =>
      Array.from(fake.bindGroups[index].entries).map((e) => e.resource);
    assert.equal(bindings(2)[1], bindings(3)[3]);
    assert.equal(bindings(3)[1], bindings(2)[3]);
    assert.notEqual(bindings(2)[1], bindings(2)[3]);
    assert.equal(bindings(4)[2], bindings(3)[3]); // Last Jacobi writes pressure zero.
    assert.equal(bindings(4)[3], bindings(0)[1]); // Projected field is next step's input.
    assert.deepEqual(
      commands.passes.slice(4).map((p) => p.draws),
      [[3], [3]],
    );
    runtime.dispose();
    runtime.dispose();
    assert.equal(fake.destroyed.length, 9);
  });
test('paused smoke draws resident fields and rejects invalid steps before writes', async () => {
  const fake = gpu(),
    runtime = await createSmoke(fake.device, spec),
    commands = recording();
  const frame = { ...smokeCamera(), dt: 0, outputView: {} as GPUTextureView };
  runtime.encode(commands.encoder, frame);
  assert.deepEqual(
    commands.passes.map((p) => p.label),
    SMOKE_PASSES.slice(4),
  );
  assert.equal(fake.writes.length, 1);
  for (const dt of [-1, NaN, 1])
    assert.throws(() => runtime.encode(commands.encoder, { ...frame, dt }));
  assert.equal(fake.writes.length, 1);
  runtime.dispose();
  assert.throws(() => runtime.encode(commands.encoder, frame), /DISPOSED/);
});
test('declared memory includes odd-sized images and setup failure releases allocations', async () => {
  const plan = smokePlan(spec);
  assert.equal(plan.gridBytes, 917504);
  assert.equal(plan.totalBytes, 917504 + 51 * 26 * 12 + 144);
  assert.throws(() => smokePlan({ ...spec, width: 1000000 }), /BUDGET/);
  const fake = gpu();
  fake.device.createComputePipelineAsync = async () => {
    throw new Error('compile rejected');
  };
  await assert.rejects(createSmoke(fake.device, spec), /compile rejected/);
  assert.equal(fake.destroyed.length, 9);
});
