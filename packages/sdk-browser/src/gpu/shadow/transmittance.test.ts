// #35: a blended caster's shadow is a transmittance beside the depth, multiplied into the PCF.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEND_TRANSMITTANCE_WGSL,
  TRANSMITTANCE_BLEND,
  TRANSMITTANCE_CLEAR,
  TRANSMITTANCE_DEPTH_KEEP,
  blendCoverage,
  castsBlendShadow,
  createShadowTransmittance,
  shadowTransmittanceBytes,
} from './transmittance.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { POISSON_16, directShadowWgsl } from '../../lighting/direct/shadowWgsl.ts';
import type { PageSurface } from '../../page/surface.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

type Texel = [number, number, number, number];
const f16 = (Math as unknown as { f16round(x: number): number }).f16round;
const surface = (opacity: number) =>
  ({ blending: 'normal', transmission: 0, opacity }) as unknown as PageSurface;

/** One blend component of the GPU, on the factors and operations the layer's state names. */
function blendComponent(c: GPUBlendComponent, src: number, dst: number) {
  const factor = (f: GPUBlendFactor | undefined) =>
    f === 'zero' ? 0 : f === 'src' ? src : f === 'dst' ? dst : 1;
  if (c.operation === 'max') return Math.max(src, dst);
  return src * factor(c.srcFactor) + dst * factor(c.dstFactor);
}
/** The texel after the fragment `src` lands on `dst`, stored at half precision. */
const land = (dst: Texel, src: Texel): Texel =>
  dst.map((d, i) =>
    f16(blendComponent(i < 3 ? TRANSMITTANCE_BLEND.color : TRANSMITTANCE_BLEND.alpha, src[i], d)),
  ) as Texel;
const clear = (): Texel => Object.values(TRANSMITTANCE_CLEAR) as Texel;
/** What `blendTransmittance` returns: `1 − coverage`, and the depth lowered by one half step. */
const fragment = (coverage: number, depth: number): Texel => {
  const t = 1 - coverage;
  return [t, t, t, depth * TRANSMITTANCE_DEPTH_KEEP];
};

/**
 * CPU oracle of `shadowPcf` away from a seam: the sixteen taps, each a bilinear depth comparison
 * (lit when the reference is in front, reversed depth) times `shadowThrough` at the tap's texel.
 */
function pcf(depthAt: (x: number, y: number) => number, layerAt: (x: number, y: number) => Texel) {
  return (tx: number, ty: number, reference: number) => {
    let lit = 0;
    for (const [px, py] of POISSON_16) {
      const x = tx + px - 0.5,
        y = ty + py - 0.5,
        x0 = Math.floor(x),
        y0 = Math.floor(y),
        fx = x - x0,
        fy = y - y0;
      let compare = 0;
      for (const [dx, dy, w] of [
        [0, 0, (1 - fx) * (1 - fy)],
        [1, 0, fx * (1 - fy)],
        [0, 1, (1 - fx) * fy],
        [1, 1, fx * fy],
      ])
        compare += w * (reference > depthAt(x0 + dx, y0 + dy) ? 1 : 0);
      const s = layerAt(Math.floor(tx + px), Math.floor(ty + py));
      lit += compare * (reference <= s[3] ? s[0] : 1);
    }
    return lit / POISSON_16.length;
  };
}
/** Spread of `read` over 32 × 32 receivers across a 4 × 4-texel window. */
function spread(read: (x: number, y: number) => number) {
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < 32; i++)
    for (let j = 0; j < 32; j++) {
      const v = read(20 + i / 8, 20 + j / 8);
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
  return { low, high };
}

test('the shadow read multiplies each PCF comparison by the texel of the layer there', () => {
  const wgsl = directShadowWgsl(8, null, 18);
  assert.match(wgsl, /var shadowTransmittance:texture_2d<f32>/);
  assert.match(wgsl, /textureLoad\(shadowTransmittance,vec2i\(floor\(a\)\),0\)/);
  assert.match(wgsl, /select\(1\.0,s\.r,reference<=s\.a\)/);
  assert.match(wgsl, /if\(through\)\{c\*=shadowThrough\(offset\+t\+POISSON\[tap\],reference\)/);
  assert.equal(wgsl.match(/,through\)/g)?.length, 4, 'every comparison split along a seam too');
  assert.ok(SHADOW_DEPTH_SHADER.includes(BLEND_TRANSMITTANCE_WGSL));
  assert.match(BLEND_TRANSMITTANCE_WGSL, /vec4f\(vec3f\(1\.0-coverage\),depth\*/);
});

test('a filtered blended shadow is uniform over a constant opacity', () => {
  const opacity = 5 / 16,
    pane = 0.5,
    floor = 0.2;
  const layer = land(clear(), fragment(blendCoverage(surface(opacity)), pane));
  const read = pcf(
    () => 0,
    () => layer,
  );
  const { low, high } = spread((x, y) => read(x, y, floor));
  assert.equal(high - low, 0, 'no spatial variation');
  assert.equal(low, f16(1 - opacity));
  // The refused representation: the pane's depth kept on 5 texels of each 4×4 block, which the
  // same PCF averaged into a pattern swinging by a third of full shadow.
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const dithered = pcf(
    (x, y) => (opacity * 16 > bayer[(y & 3) * 4 + (x & 3)] ? pane : 0),
    () => clear(),
  );
  const before = spread((x, y) => dithered(x, y, floor));
  assert.ok(before.high - before.low > 0.3, `${before.low} to ${before.high}`);
});

test('opacity 0 lets all the light through, opacity 1 none', () => {
  assert.equal(castsBlendShadow(surface(0)), false, 'no row: the texel keeps its clear value');
  assert.equal(clear()[0], 1);
  const opaque = land(clear(), fragment(blendCoverage(surface(1)), 0.5));
  assert.equal(opaque[0], 0);
  assert.equal(
    pcf(
      () => 0,
      () => opaque,
    )(10, 10, 0.2),
    0,
  );
});

test('two stacked panes multiply, whatever their order, and keep the nearest depth', () => {
  const near = fragment(0.4, 0.7),
    far = fragment(0.5, 0.3);
  const a = land(land(clear(), near), far),
    b = land(land(clear(), far), near);
  assert.deepEqual(a, b);
  assert.equal(a[0], f16(0.6 * 0.5));
  assert.equal(a[3], f16(0.7 * TRANSMITTANCE_DEPTH_KEEP));
});

test('a receiver in front of the pane, or on it, keeps its light', () => {
  const pane = 0.62;
  const layer = land(clear(), fragment(0.75, pane));
  const read = pcf(
    () => 0,
    () => layer,
  );
  assert.equal(read(10, 10, 0.9), 1, 'between the light and the pane');
  assert.equal(read(10, 10, pane), 1, 'the pane itself, before any bias');
  assert.equal(read(10, 10, 0.3), f16(0.25), 'behind it');
});

test('the opaque casters write depth as before; the blended ones write the layer alone', () => {
  installGpuGlobals();
  const pipelines: GPURenderPipelineDescriptor[] = [],
    passes: GPURenderPassDescriptor[] = [];
  const device = {
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createRenderPipeline: (d: GPURenderPipelineDescriptor) => (pipelines.push(d), d),
  } as unknown as GPUDevice;
  const encoder = {
    beginRenderPass: (d: GPURenderPassDescriptor) => (passes.push(d), { end() {} }),
  } as unknown as GPUCommandEncoder;
  const layer = createShadowTransmittance(device, {} as never, {} as never, 2, encoder);
  const [clearing] = passes[0].colorAttachments as GPURenderPassColorAttachment[];
  assert.deepEqual([clearing.loadOp, clearing.clearValue], ['clear', TRANSMITTANCE_CLEAR]);
  assert.equal(layer.bytes, shadowTransmittanceBytes(2));
  const of = (p: unknown) => p as GPURenderPipelineDescriptor;
  const depth = of(layer.depth),
    blend = of(layer.blend);
  assert.equal(depth.vertex.entryPoint, 'shadow_vs');
  assert.deepEqual(depth.depthStencil, {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'greater',
  });
  assert.equal([...depth.fragment!.targets][0]!.writeMask, 0, 'no colour from an opaque caster');
  assert.equal(blend.vertex.entryPoint, 'shadow_blend_vs');
  assert.equal(blend.depthStencil!.depthWriteEnabled, false, 'no depth from a blended one');
  assert.equal([...blend.fragment!.targets][0]!.blend, TRANSMITTANCE_BLEND);
});
