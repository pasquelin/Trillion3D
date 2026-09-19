/**
 * The GPU side of the live demo: pipeline, buffers and the one draw, built once per device.
 * The depth target follows the canvas, and its view is rebuilt only when the size changes.
 */
const VERTEX_STRIDE = 36;
const UNIFORM_BYTES = 80;

export function createGpuResources(device, { shader, geometry, format, depthCompare }) {
  const module = device.createShaderModule({ code: shader });
  const vertices = device.createBuffer({
    size: geometry.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertices, 0, geometry);
  const uniforms = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare, format: 'depth24plus' },
  });

  let depth = null;
  let depthView = null;
  const ensureDepth = (width, height) => {
    if (depth && depth.width === width && depth.height === height) return depthView;
    depth?.destroy();
    depth = device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    depthView = depth.createView();
    return depthView;
  };

  return {
    device,
    format,
    /** One frame: the uniforms uploaded, the mesh drawn, the pass submitted. */
    draw(context, canvas, uniformData, depthClear = 0) {
      device.queue.writeBuffer(uniforms, 0, uniformData);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.06, g: 0.07, b: 0.09, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: ensureDepth(canvas.width, canvas.height),
          depthClearValue: depthClear,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertices);
      pass.draw(geometry.length / (VERTEX_STRIDE / Float32Array.BYTES_PER_ELEMENT));
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
