// #35: the transmittance layer's textures, bytes, pipelines and pass, at half the pool's resolution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSMITTANCE_BLEND,
  TRANSMITTANCE_CLEAR,
  createShadowTransmittance,
  shadowTransmittanceBytes,
} from './transmittance.ts';
import { shadowTransmittanceDraws } from './transmittanceDraws.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

/** Every call an object receives, by name, in order. */
function recorder<T>() {
  const calls: Array<[string, unknown[]]> = [];
  // A method set on the object stands; any other is recorded and returns its first argument.
  const target = new Proxy({} as Record<string, unknown>, {
    get: (own, name: string) =>
      own[name] ?? ((...args: unknown[]) => (calls.push([name, args]), args[0])),
  });
  return { target: target as T, calls };
}

function created(poolSide: number) {
  installGpuGlobals();
  const device = recorder<GPUDevice>(),
    encoder = recorder<GPUCommandEncoder>();
  (encoder.target as unknown as { beginRenderPass: unknown }).beginRenderPass = (
    d: GPURenderPassDescriptor,
  ) => (encoder.calls.push(['beginRenderPass', [d]]), { end() {} });
  (device.target as unknown as { createTexture: unknown }).createTexture = (
    d: GPUTextureDescriptor,
  ) => (
    device.calls.push(['createTexture', [d]]),
    { createView: () => d, destroy() {}, depthOrArrayLayers: 1 }
  );
  const made = shadowTransmittanceDraws(device.target, {} as never, [{}, {}] as never).made();
  const layer = createShadowTransmittance(
    device.target,
    made,
    [{}] as never,
    poolSide,
    encoder.target,
  );
  const of = (name: string) => device.calls.filter(([n]) => n === name).map(([, [d]]) => d);
  return { layer, of, passes: encoder.calls.map(([, [d]]) => d as GPURenderPassDescriptor) };
}

test('the layer holds 8 bytes per 4 page texels: 128 MiB a layer of the pool', () => {
  const texels = (side: number) => (side * SHADOW_PAGE) ** 2;
  for (const side of [1, 2, 51, 64])
    assert.equal(shadowTransmittanceBytes(side), (texels(side) / 4) * 8);
  assert.equal(shadowTransmittanceBytes(64, 2), 2 * 128 * 2 ** 20);
  const { layer, of } = created(2);
  assert.equal(layer.bytes, shadowTransmittanceBytes(2));
  const textures = of('createTexture') as GPUTextureDescriptor[];
  assert.deepEqual(
    textures.map((t) => [t.format, ...(t.size as number[])]),
    [
      ['rgba8unorm', SHADOW_PAGE, SHADOW_PAGE, 1],
      ['depth32float', SHADOW_PAGE, SHADOW_PAGE, 1],
    ],
    'half the side of a pool of 2 pages',
  );
});

test('the layer starts with all the light and no translucent depth', () => {
  const [pass] = created(2).passes;
  const [colour] = pass.colorAttachments as GPURenderPassColorAttachment[];
  assert.deepEqual([colour.loadOp, colour.clearValue], ['clear', TRANSMITTANCE_CLEAR]);
  const depth = pass.depthStencilAttachment!;
  assert.deepEqual([depth.depthLoadOp, depth.depthClearValue], ['clear', 0]);
});

test('depth-only then colour-only draws of the blended rows, the opaque depth read beside', () => {
  const { layer, of } = created(2);
  const p = (x: unknown) => x as GPURenderPipelineDescriptor;
  const [depth, blend] = layer.draws.map(p);
  assert.deepEqual(
    [depth, blend].map((d) => [d.vertex.entryPoint, d.fragment!.entryPoint]),
    [
      ['shadow_blend_vs', 'shadow_blend_fs'],
      ['shadow_blend_vs', 'shadow_blend_fs'],
    ],
  );
  assert.deepEqual(depth.depthStencil, {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'greater',
  });
  assert.equal([...depth.fragment!.targets][0]!.writeMask, 0, 'no colour from the depth draw');
  assert.deepEqual(blend.depthStencil, {
    format: 'depth32float',
    depthWriteEnabled: false,
    depthCompare: 'always',
  });
  assert.equal([...blend.fragment!.targets][0]!.blend, TRANSMITTANCE_BLEND);
  const [opaque] = of('createBindGroupLayout') as GPUBindGroupLayoutDescriptor[];
  assert.deepEqual([...opaque.entries][0].texture, { sampleType: 'depth' });
});
