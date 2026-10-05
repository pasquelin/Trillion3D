// The transparent mirror on the GPU: the shipped blend fragment drawn over a 32-pixel square by the
// proof's vertex, with a one-triangle resident proxy whose face radiance the surface cache holds
// (`blendMirrorRig.ts`), with and without its mirror term; each image's f16 pixels read back.
import { reflectionLayout } from '../../../packages/sdk-browser/src/reflections/layout.ts';
import { createWebgpuBlendPipelines } from '../../../packages/sdk-browser/src/webgpu/blend/pipelines.ts';
import { BLEND_SHADER } from '../../../packages/sdk-browser/src/gpu/core/shaderTexts.fixture.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import { mirrorGroup, mirrorVertex, proxyOnlyReflection } from './blendMirrorRig.ts';

/** The image's side, in pixels. */
const WIDTH = 32;
/** The blend fragment's mirror term: the program without it is the one before the mirror. */
const MIRROR_TERM = 'rgb+=mirrorLighting(s.rgb,m,clamped,s.N,V,in.view);';

export async function run() {
  const opened = await openGpuDevice();
  if (!opened) throw new Error('no WebGPU adapter');
  const { device, errors } = opened;
  if (!BLEND_SHADER.includes(MIRROR_TERM)) throw new Error('the blend has no mirror term');
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const rig = mirrorGroup(device, blendBindGroupLayout);
  const reflection = proxyOnlyReflection(device);
  const target = device.createTexture({
    size: [WIDTH, WIDTH],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const feedback = device.createTexture({
    size: [WIDTH, WIDTH],
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const read = device.createBuffer({
    size: WIDTH * 256,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const compilation: string[] = [];
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [blendBindGroupLayout, reflectionLayout(device)],
  });
  /** Each program, compiled once: the blend fragment with or without its mirror term, over the
   *  proof's vertex for one surface. */
  const programs = new Map<string, Promise<GPURenderPipeline | undefined>>();
  const programOf = (mirror: boolean, rough: boolean, model: number) => {
    const key = `${mirror}/${rough}/${model}`;
    if (!programs.has(key)) {
      const code = mirror ? BLEND_SHADER : BLEND_SHADER.replace(MIRROR_TERM, '');
      const made = opened.compile(code + mirrorVertex(rough ? 0.3 : 0, model)).then((compiled) => {
        compilation.push(...compiled.compilation);
        if (compiled.compilation.length) return undefined;
        return device.createRenderPipelineAsync({
          layout,
          vertex: { module: compiled.module, entryPoint: 'mirrorVertex' },
          fragment: {
            module: compiled.module,
            entryPoint: 'fs',
            targets: [{ format: 'rgba16float' }, { format: 'r32uint' }],
          },
          primitive: { topology: 'triangle-list' },
        });
      });
      programs.set(key, made);
    }
    return programs.get(key)!;
  };
  /** The square drawn by the blend fragment, with or without its mirror term: its f16 pixels. */
  async function render(mirror: boolean, rough = false, model = 0) {
    const pipeline = await programOf(mirror, rough, model);
    if (!pipeline) return [];
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [target, feedback].map((attachment) => ({
        view: attachment.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, rig.group);
    pass.setBindGroup(1, reflection.group);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: 256 }, [
      WIDTH,
      WIDTH,
    ]);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const pixels = Array.from(new Uint16Array(read.getMappedRange().slice(0)));
    read.unmap();
    return pixels;
  }
  // The diffuse and toon models, with and without the mirror term, over a dark roughness map.
  const families = [];
  for (const model of [1, 2])
    families.push([await render(true, false, model), await render(false, false, model)]);
  const mirror = await render(true);
  const repeat = await render(true);
  const previous = await render(false);
  const rough = await render(true, true);
  const roughPrevious = await render(false, true);
  // The proxy triangle moved and its faces turned green: the mirror follows both.
  rig.moveProxy([-0.45, -0.2, 1, 0.4, -0.2, 1, -0.45, 0.5, 1]);
  rig.faces([0.05, 0.8, 0.2, 1]);
  const second = await render(true);
  // Bounce off: no proxy is read, with or without the mirror term.
  rig.bounceOff();
  const off = await render(true);
  const offPrevious = await render(false);
  reflection.dispose();
  rig.dispose();
  const adapter = (await opened.fermer()).court;
  return {
    mirror,
    families,
    second,
    rough,
    roughPrevious,
    repeat,
    previous,
    off,
    offPrevious,
    errors,
    compilation,
    adapter,
    width: WIDTH,
  };
}
