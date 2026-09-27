// OMB-29, #961: the coverage count reads each workgroup's alphas once, into workgroup memory. Run
// on the GPU beside develop's count — four reads a texel — on random and flat alphas, from 1×1 to
// odd and wide sizes, on level 0 and on reduced levels: the bins are the same, word for word.
//
//   node --experimental-strip-types tests/browser/probes/coverage-count-gpu.ts
import assert from 'node:assert/strict';
import {
  COVERAGE_WGSL,
  LEVEL_BIN_BYTES,
} from '../../../packages/sdk-browser/src/texture/coverageMips.ts';
import { levelSize } from '../../../packages/sdk-browser/src/texture/tiles.ts';
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

const SHARED = `  for(var j=i;j<81u;j+=64u){alphas[j]=alphaAt(o+vec2u(j%9u,j/9u));}
  workgroupBarrier();
  if(all(id.xy<sizeOf(k))){
   let j=(id.y-o.y)*9u+id.x-o.x;
   let a=vec4u(alphas[j],alphas[j+1u],alphas[j+9u],alphas[j+10u]);`;
const DEVELOP = `  if(all(id.xy<sizeOf(k))){
   let q=id.xy;
   let a=vec4u(alphaAt(q),alphaAt(q+vec2u(1u,0u)),alphaAt(q+vec2u(0u,1u)),alphaAt(q+vec2u(1u,1u)));`;
assert.ok(COVERAGE_WGSL.includes(SHARED), 'the shipped count reads its workgroup’s alphas');
const develop = COVERAGE_WGSL.replace(SHARED, DEVELOP);

const next = random(961);
const sizes = [
  [1, 1, 0],
  [3, 5, 0],
  [9, 17, 0],
  [769, 33, 0],
  [64, 64, 1],
  [65, 7, 1],
  [2049, 3, 1],
];
for (let n = 0; n < 12; n++)
  sizes.push([1 + Math.floor(next() * 300), 1 + Math.floor(next() * 300), Math.floor(next() * 3)]);
const cases = sizes.map(([width, height, level], n) => {
  const [w, h] = levelSize(width, height, Math.max(0, level - 1));
  const flat = n % 5 === 1 ? 0 : n % 5 === 2 ? 255 : -1;
  const texels = Array.from({ length: w * h * 4 }, () =>
    flat < 0 ? Math.floor(next() * 256) : flat,
  );
  const cutoff = 1 + Math.floor(next() * 255),
    bytes = (level + 1) * LEVEL_BIN_BYTES,
    dispatch = levelSize(width, height, level);
  return { width, height, level, w, h, cutoff, texels, bytes, dispatch };
});

const lu = await dansPageWebgpu(
  async ({ shaders, cases }) => {
    const gpu = await globalThis.ouvrirAppareil();
    if (!gpu) return { indisponible: 'no WebGPU adapter' };
    const { device } = gpu;
    const pipelines = await Promise.all(
      shaders.map(async (code) => {
        const { module, compilation } = await gpu.compile(code);
        if (compilation.length) throw new Error(compilation.join('\n'));
        return device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint: 'count' },
        });
      }),
    );
    const bins: number[][][] = [];
    for (const c of cases) {
      const source = device.createTexture({
        size: [c.w, c.h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: source },
        Uint8Array.from(c.texels),
        { bytesPerRow: c.w * 4 },
        [c.w, c.h],
      );
      const uniform = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        uniform,
        0,
        Uint32Array.of(c.w, c.h, c.cutoff, 0, c.width, c.height, c.level, 0),
      );
      const size = c.bytes,
        [dw, dh] = c.dispatch;
      bins.push(
        await Promise.all(
          pipelines.map(async (pipeline) => {
            const cover = device.createBuffer({
              size,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            const read = device.createBuffer({
              size,
              usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(
              0,
              device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: source.createView() },
                  { binding: 1, resource: { buffer: uniform } },
                  { binding: 2, resource: { buffer: cover } },
                ],
              }),
            );
            pass.dispatchWorkgroups(Math.ceil(dw / 8), Math.ceil(dh / 8));
            pass.end();
            encoder.copyBufferToBuffer(cover, 0, read, 0, size);
            device.queue.submit([encoder.finish()]);
            await read.mapAsync(GPUMapMode.READ);
            return [...new Uint32Array(read.getMappedRange())];
          }),
        ),
      );
    }
    return { adaptateur: (await gpu.fermer()).court, erreurs: gpu.erreurs, bins };
  },
  { shaders: [develop, COVERAGE_WGSL], cases },
);
assert.equal(lu.indisponible ?? null, null);
assert.deepEqual(lu.erreurs, []);
console.log(JSON.stringify({ adaptateur: lu.adaptateur, cas: cases.length }));
lu.bins!.forEach(([before, after], n) => {
  const { width, height, level } = cases[n];
  assert.ok(before.some(Boolean), `case ${n}: develop counted nothing`);
  assert.deepEqual(after, before, `case ${n}, ${width}×${height} level ${level}: bins differ`);
});
