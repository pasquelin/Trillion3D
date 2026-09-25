import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts';
import type { GuideSet } from './guideSet.ts';
import { GUIDE_INSTANCE_FLOATS } from './guidePack.ts';
import {
  GUIDE_UNIFORM_FLOATS,
  GUIDE_WGSL,
  REVERSED_NEAR_PLANE,
  writeGuideView,
} from './guideShaders.ts';

/** Label of the guide pass: its GPU time is read under this name, apart from the beauty passes. */
const GUIDE_PASS = 'Trillion3D guides';

const STRIDE = GUIDE_INSTANCE_FLOATS * 4;

/**
 * The WebGPU guide pass. Nothing — pipeline, buffers — exists until the first frame that shows a
 * guide: a session whose page drew none never builds it. It draws on the display colour target,
 * AFTER temporal accumulation and composition, with the camera's unjittered view-projection: the
 * guides never enter the history the next image reprojects, so a moving camera cannot smear
 * them, and a still one does not make them shimmer. It reads the opaque depth, never writes it.
 */
export function createWebgpuGuidePass(device: GPUDevice) {
  let pipeline: GPURenderPipeline | undefined,
    uniform: GPUBuffer | undefined,
    instances: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    uploaded: unknown;
  const view = new Float32Array(GUIDE_UNIFORM_FLOATS);
  const build = () => {
    const module = device.createShaderModule({ label: GUIDE_PASS, code: GUIDE_WGSL });
    pipeline = device.createRenderPipeline({
      label: GUIDE_PASS,
      layout: 'auto',
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
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: DEPTH_COMPARE_OR_EQUAL,
      },
    });
    uniform = device.createBuffer({
      label: GUIDE_PASS,
      size: GUIDE_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
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
     * own view-projection — never the jittered one; returns false, and encodes nothing, when none
     * is shown.
     */
    encode(
      encoder: GPUCommandEncoder,
      guides: GuideSet,
      color: GPUTextureView,
      depth: GPUTextureView,
      camera: { viewProjection: ArrayLike<number> },
      [width, height]: readonly number[],
    ) {
      const packed = guides.pack();
      if (!packed.count) return false;
      if (!pipeline) build();
      upload(packed);
      writeGuideView(
        view,
        camera.viewProjection,
        packed.anchor,
        width,
        height,
        REVERSED_NEAR_PLANE,
      );
      device.queue.writeBuffer(uniform!, 0, view);
      const pass = encoder.beginRenderPass({
        label: GUIDE_PASS,
        colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depth, depthReadOnly: true },
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
      pipeline = uniform = instances = group = uploaded = undefined;
    },
  };
}

export type WebgpuGuidePass = ReturnType<typeof createWebgpuGuidePass>;
