import { PRESENT_AT_SHADER } from './presentWgsl.ts';

/** A rectangle of the canvas, in canvas pixels from the top left. */
export type PresentRect = { x: number; y: number; width: number; height: number };

/**
 * Presents a persistent view's image at its rectangle of the canvas: the canvas keeps its size,
 * and what the main view and the other views presented there this frame is kept (`load`). The
 * program is made at the first such present: a session with the main view alone never makes it.
 */
export function createPresentAt(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
) {
  let pipeline: GPURenderPipeline | undefined;
  const groups = new WeakMap<GPUTexture, GPUBindGroup>();
  const group = (image: GPUTexture) => {
    let made = groups.get(image);
    if (!made) {
      made = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: image.createView() }],
      });
      groups.set(image, made);
    }
    return made;
  };
  /** `canvas` is the canvas's size: the part of `at` past its right or bottom edge is not drawn,
   *  and a rectangle that starts left of or above it is not drawn at all. */
  return (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    image: GPUTexture,
    at: PresentRect,
    canvas: { width: number; height: number },
  ) => {
    const width = Math.min(at.width, canvas.width - at.x),
      height = Math.min(at.height, canvas.height - at.y);
    if (width <= 0 || height <= 0 || at.x < 0 || at.y < 0) return;
    if (!pipeline) {
      const module = device.createShaderModule({ code: PRESENT_AT_SHADER });
      pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'fullscreenAt' },
        fragment: { module, entryPoint: 'presentAt', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    const pass = encoder.beginRenderPass({
      label: 'Trillion3D view present',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group(image));
    pass.setViewport(at.x, at.y, width, height, 0, 1);
    pass.setScissorRect(at.x, at.y, width, height);
    pass.draw(3, 1, 0, at.x + at.y * 65536);
    pass.end();
  };
}
