// OMB-29, #961: the coverage count reads each workgroup's alphas once, into workgroup memory. Run
// on the GPU beside develop's count — four reads a texel — on random and flat alphas, from 1×1 to
// odd and wide sizes, on level 0 and on reduced levels: the bins are the same, word for word.
//
//   node --experimental-strip-types tests/browser/probes/coverage-count-gpu.ts
import assert from 'node:assert/strict';
import { LEVEL_BIN_BYTES } from '../../../packages/sdk-browser/src/texture/coverageMips.ts';
import { COVERAGE_WGSL } from '../../../packages/sdk-browser/src/texture/mipsWgsl.ts';
import { levelSize } from '../../../packages/sdk-browser/src/texture/tiles.ts';
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

if (import.meta.main) {
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
  // Width, height and level: 1×1, odd, wide and tall, level 0 and reduced; then random ones.
  // prettier-ignore
  const sizes = [[1, 1, 0], [3, 5, 0], [9, 17, 0], [769, 33, 0], [64, 64, 1], [65, 7, 1], [2049, 3, 1]];
  for (let n = 0; n < 12; n++)
    sizes.push([
      1 + Math.floor(next() * 300),
      1 + Math.floor(next() * 300),
      Math.floor(next() * 3),
    ]);
  const cases = sizes.map(([width, height, level], n) => {
    const [w, h] = levelSize(width, height, Math.max(0, level - 1));
    // Flat transparent, flat opaque, or random alphas.
    const flat = [-1, 0, 255][n % 3];
    const texels = Array.from({ length: w * h * 4 }, () =>
      flat < 0 ? Math.floor(next() * 256) : flat,
    );
    const uniform = [w, h, 1 + Math.floor(next() * 255), 0, width, height, level, 0];
    return {
      w,
      h,
      texels,
      uniform,
      bytes: (level + 1) * LEVEL_BIN_BYTES,
      dispatch: levelSize(width, height, level),
    };
  });

  const lu = await dansPageWebgpu(
    async ({ shaders, cases }) => {
      const gpu = await globalThis.openGpuDevice();
      if (!gpu) return { indisponible: 'no WebGPU adapter' };
      const { device } = gpu;
      const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
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
      for (const { w, h, texels, uniform, bytes, dispatch } of cases) {
        const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
        const source = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage });
        device.queue.writeTexture(
          { texture: source },
          Uint8Array.from(texels),
          { bytesPerRow: w * 4 },
          [w, h],
        );
        const level = buffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        device.queue.writeBuffer(level, 0, Uint32Array.from(uniform));
        const read = async (pipeline: GPUComputePipeline) => {
          const cover = buffer(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
            out = buffer(bytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
          const entries = [source.createView(), { buffer: level }, { buffer: cover }].map(
            (resource, binding) => ({ binding, resource }),
          );
          const encoder = device.createCommandEncoder(),
            pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(
            0,
            device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }),
          );
          pass.dispatchWorkgroups(Math.ceil(dispatch[0] / 8), Math.ceil(dispatch[1] / 8));
          pass.end();
          encoder.copyBufferToBuffer(cover, 0, out, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await out.mapAsync(GPUMapMode.READ);
          return [...new Uint32Array(out.getMappedRange())];
        };
        bins.push(await Promise.all(pipelines.map(read)));
      }
      return { adaptateur: (await gpu.fermer()).court, erreurs: gpu.erreurs, bins };
    },
    { shaders: [develop, COVERAGE_WGSL], cases },
  );
  assert.equal(lu.indisponible ?? null, null);
  assert.deepEqual(lu.erreurs, []);
  console.log(JSON.stringify({ adaptateur: lu.adaptateur, cas: cases.length }));
  lu.bins!.forEach(([before, after], n) => {
    const [width, height, level] = sizes[n];
    assert.ok(before.some(Boolean), `case ${n}: develop counted nothing`);
    assert.deepEqual(after, before, `case ${n}, ${width}×${height} level ${level}: bins differ`);
  });
}
