import type { GuideSet } from './guideSet.ts';
import { GUIDE_INSTANCE_FLOATS } from './guidePack.ts';
import { GUIDE_UNIFORM_FLOATS, GUIDE_WGSL, writeGuideView } from './guideShaders.ts';

/** Label of the guide pass: its GPU time is read under this name, apart from the beauty passes. */
const GUIDE_PASS = 'Trillion3D guides';

const STRIDE = GUIDE_INSTANCE_FLOATS * 4;

/**
 * The WebGPU guide pass. Nothing — pipeline, buffers — exists until the first frame that shows a
 * guide: a session whose page drew none never builds it. It draws on the display colour target,
 * AFTER temporal accumulation and composition, with the camera's unjittered view-projection: the
 * guides never enter the history the next image reprojects, so a moving camera cannot smear
 * them, and a still one does not make them shimmer. It reads the opaque depth as a texture and
 * tests against it in the shader, allowing the depth the image's jitter moved
 * (`jitterDepthSlack`): the scene was drawn jittered, the guides are not.
 */
export function createWebgpuGuidePass(device: GPUDevice) {
  let pipeline: GPURenderPipeline | undefined,
    uniform: GPUBuffer | undefined,
    instances: GPUBuffer | undefined,
    layout: GPUBindGroupLayout | undefined,
    group: GPUBindGroup | undefined,
    boundDepth: GPUTextureView | undefined,
    uploaded: unknown;
  const view = new Float32Array(GUIDE_UNIFORM_FLOATS);
  const build = () => {
    const module = device.createShaderModule({ label: GUIDE_PASS, code: GUIDE_WGSL });
    layout = device.createBindGroupLayout({
      label: GUIDE_PASS,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ],
    });
    pipeline = device.createRenderPipeline({
      label: GUIDE_PASS,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'unorm8x4' },
              { shaderLocation: 3, offset: 28, format: 'float32' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    uniform = device.createBuffer({
      label: GUIDE_PASS,
      size: GUIDE_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  };
  /** The group binds the depth target, made again when a resize gave it a new view. */
  const bind = (depth: GPUTextureView) => {
    if (boundDepth === depth) return;
    group = device.createBindGroup({
      layout: layout!,
      entries: [
        { binding: 0, resource: { buffer: uniform! } },
        { binding: 1, resource: depth },
      ],
    });
    boundDepth = depth;
  };
  /** The instances, uploaded again only when the set packed anew; the buffer grows by doubling. */
  const upload = (packed: ReturnType<GuideSet['pack']>) => {
    if (uploaded === packed) return;
    const bytes = packed.count * STRIDE;
    if (!instances || instances.size < bytes) {
      instances?.destroy();
      instances = device.createBuffer({
        label: GUIDE_PASS,
        size: Math.max(STRIDE, 2 ** Math.ceil(Math.log2(bytes))),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(instances, 0, packed.data);
    uploaded = packed;
  };
  return {
    /**
     * Draws the visible guides over `color`, tested against `depth`, seen through the camera's
     * own view-projection — never the jittered one — at the host's `pixelRatio`; `jitter` is the
     * pixel offset `depth` was drawn with. Returns false, and encodes nothing, when none is shown.
     */
    encode(
      encoder: GPUCommandEncoder,
      guides: GuideSet,
      color: GPUTextureView,
      depth: GPUTextureView,
      camera: { viewProjection: ArrayLike<number> },
      [width, height]: readonly number[],
      pixelRatio: number,
      jitter: ArrayLike<number>,
    ) {
      const packed = guides.pack();
      if (!packed.count) return false;
      if (!pipeline) build();
      upload(packed);
      bind(depth);
      writeGuideView(view, camera.viewProjection, packed.anchor, width, height, pixelRatio, jitter);
      device.queue.writeBuffer(uniform!, 0, view);
      const pass = encoder.beginRenderPass({
        label: GUIDE_PASS,
        colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline!);
      pass.setBindGroup(0, group!);
      pass.setVertexBuffer(0, instances!);
      pass.draw(6, packed.count);
      pass.end();
      return true;
    },
    dispose() {
      uniform?.destroy();
      instances?.destroy();
      pipeline = layout = uniform = instances = group = boundDepth = uploaded = undefined;
    },
  };
}

export type WebgpuGuidePass = ReturnType<typeof createWebgpuGuidePass>;
