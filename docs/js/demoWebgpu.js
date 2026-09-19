/**
 * Interactive WebGPU 3D viewport demo with live matrix and camera calculations.
 */
import { composeMatrix4, multiplyMatrix4, perspectiveProjection } from './mathKernels.js';
import { buildCubeGeometry, WGSL_SHADER } from './demoGeometry.js';

let animationId = null;
let rotX = 0.35,
  rotY = 0.55;
let isDragging = false,
  lastMouseX = 0,
  lastMouseY = 0;
let fovDeg = 50;

export async function initWebGpuDemo(canvas, statsEl, modeGetter) {
  if (animationId) cancelAnimationFrame(animationId);
  setupMouseControls(canvas);
  if (!navigator.gpu) {
    statsEl.innerHTML = '<span class="text-warning">WebGPU not available in this browser.</span>';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });

  const mod = device.createShaderModule({ code: WGSL_SHADER });
  const geomData = buildCubeGeometry();
  const vBuf = device.createBuffer({
    size: geomData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vBuf, 0, geomData);

  const uBuf = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const bindGroup = device.createBindGroup({
    layout: bLayout,
    entries: [{ binding: 0, resource: { buffer: uBuf } }],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bLayout] }),
    vertex: {
      module: mod,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'greater-equal', format: 'depth24plus' },
  });

  let depthTex = null;
  function ensureDepth() {
    if (!depthTex || depthTex.width !== canvas.width || depthTex.height !== canvas.height) {
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  const modelM = new Float64Array(16),
    projM = new Float64Array(16),
    mvpM = new Float64Array(16);
  const mvp32 = new Float32Array(20);
  let lastTime = performance.now(),
    frames = 0,
    fps = 60;

  function render(now) {
    if (canvas.clientWidth !== canvas.width || canvas.clientHeight !== canvas.height) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ensureDepth();
    if (!isDragging) rotY += 0.008;
    const t0 = performance.now();
    const qx = Math.sin(rotX * 0.5),
      qwX = Math.cos(rotX * 0.5);
    const qy = Math.sin(rotY * 0.5),
      qwY = Math.cos(rotY * 0.5);
    const q = [qx * qwY, qy * qwX, -qx * qy, qwX * qwY];
    composeMatrix4(modelM, [0, 0, -2.8], q, [1, 1, 1]);
    const aspect = canvas.width / Math.max(1, canvas.height);
    perspectiveProjection(projM, fovDeg, aspect, 0.1);
    multiplyMatrix4(mvpM, projM, modelM);
    const mathUs = ((performance.now() - t0) * 1000).toFixed(1);

    for (let i = 0; i < 16; i++) mvp32[i] = mvpM[i];
    mvp32[16] = modeGetter() === 'normals' ? 1 : 0;
    device.queue.writeBuffer(uBuf, 0, mvp32);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.06, g: 0.07, b: 0.09, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthClearValue: 0.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vBuf);
    pass.draw(36);
    pass.end();
    device.queue.submit([encoder.finish()]);

    frames++;
    if (now - lastTime >= 500) {
      fps = Math.round((frames * 1000) / (now - lastTime));
      frames = 0;
      lastTime = now;
      statsEl.textContent = `${fps} FPS · math: ${mathUs} µs · Reversed-Z WebGPU`;
    }
    animationId = requestAnimationFrame(render);
  }
  animationId = requestAnimationFrame(render);
}

function setupMouseControls(canvas) {
  canvas.onmousedown = (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };
  window.onmouseup = () => {
    isDragging = false;
  };
  window.onmousemove = (e) => {
    if (!isDragging) return;
    rotY += (e.clientX - lastMouseX) * 0.01;
    rotX += (e.clientY - lastMouseY) * 0.01;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };
}

export function setDemoFov(fov) {
  fovDeg = fov;
}
