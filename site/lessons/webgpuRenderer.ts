import { SCENE_BACKGROUND } from './scenePalette.ts';
import { evaluate } from './evaluate.ts';
import { geometryFor } from './sceneGeometry.ts';
import { getIllustrationGpu } from './webgpuDevice.ts';
import {
  DISTANCE_BY_SCENARIO,
  type MountOptions,
  type IllustrationSession,
} from './webgpuSession.ts';
import type { ScenarioState } from './scenarios.ts';

export type { IllustrationSession } from './webgpuSession.ts';

export async function mountIllustration(
  canvas: HTMLCanvasElement,
  id: string,
  state: ScenarioState,
  options: MountOptions = {},
): Promise<IllustrationSession> {
  const wrapper = canvas.closest('[data-geometry-3d]');
  let gpu;
  try {
    gpu = await getIllustrationGpu();
  } catch (error) {
    const status = wrapper?.querySelector('[data-geometry-3d-status]');
    if (status) {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = options.locale?.startsWith('fr')
        ? `WebGPU indisponible : ${message}`
        : `WebGPU unavailable: ${message}`;
      status.classList.remove('hidden');
    }
    return { update() {}, dispose() {} };
  }
  if (!gpu) {
    const status = wrapper?.querySelector('[data-geometry-3d-status]');
    if (status) {
      status.textContent = options.locale?.startsWith('fr')
        ? 'WebGPU indisponible : le schéma 2D reste utilisable.'
        : 'WebGPU unavailable: the 2D diagram remains available.';
      status.classList.remove('hidden');
    }
    return { update() {}, dispose() {} };
  }
  const { device, format, pipeline } = gpu,
    // getContext can return null per its DOM type; unguarded here exactly like the original code,
    // which never checked it either and let the failure surface as a thrown TypeError.
    context = canvas.getContext('webgpu')!;
  context.configure({ device, format, alphaMode: 'premultiplied' });
  const uniform = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  });
  let vertexBuffer: GPUBuffer | undefined,
    count = 0,
    depth: GPUTexture | undefined,
    yaw = 0.65,
    pitch = -0.35,
    distance = DISTANCE_BY_SCENARIO[id] ?? 6,
    disposed = false;
  if (options.interactive === false) distance *= 1.3;
  let scheduled = 0,
    previousFrame: number | undefined,
    consecutiveFrames = 0,
    animating = false;
  const fps = wrapper?.querySelector('[data-geometry-fps]'),
    cpu = wrapper?.querySelector('[data-geometry-cpu]'),
    memory = wrapper?.querySelector('[data-geometry-memory]');
  const render = (timestamp: number) => {
    scheduled = 0;
    if (disposed || !count) return;
    const started = performance.now();
    const width = Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio)),
      height = Math.max(2, Math.round(canvas.clientHeight * devicePixelRatio));
    if (!depth || canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      depth?.destroy();
      depth = device.createTexture({
        size: [width, height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    device.queue.writeBuffer(
      uniform,
      0,
      new Float32Array([yaw, pitch, width / height, distance, 0.4, 0.8, 0.6, 0]),
    );
    const encoder = device.createCommandEncoder(),
      pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: SCENE_BACKGROUND.gpu,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer ?? null);
    pass.draw(count);
    pass.end();
    device.queue.submit([encoder.finish()]);
    if (cpu) cpu.textContent = `${(performance.now() - started).toFixed(2)} ms`;
    const interval = previousFrame ? timestamp - previousFrame : Infinity;
    consecutiveFrames = animating && previousFrame ? consecutiveFrames + 1 : 0;
    if (fps && consecutiveFrames >= 2) fps.textContent = `${(1000 / interval).toFixed(0)}`;
    previousFrame = timestamp;
  };
  const invalidate = () => {
    if (!scheduled) scheduled = requestAnimationFrame(render);
  };
  const update = (nextState: ScenarioState) => {
    const data = geometryFor(id, evaluate(id, nextState, options.locale));
    vertexBuffer?.destroy();
    vertexBuffer = device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, data);
    count = data.length / 9;
    if (memory)
      memory.textContent = `${((Math.max(4, data.byteLength) + 32) / 1024).toFixed(1)} KiB`;
    invalidate();
  };
  let dragging = false,
    lastX = 0,
    lastY = 0;
  const down = (event: PointerEvent) => {
    if (options.interactive === false) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.01;
    pitch = Math.max(-1.3, Math.min(1.3, pitch + (event.clientY - lastY) * 0.01));
    lastX = event.clientX;
    lastY = event.clientY;
    invalidate();
  };
  const up = () => {
    dragging = false;
  };
  const wheel = (event: WheelEvent) => {
    if (options.interactive === false) return;
    event.preventDefault();
    distance = Math.max(2, Math.min(20, distance + event.deltaY * 0.01));
    invalidate();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  const resize = new ResizeObserver(invalidate);
  resize.observe(canvas);
  update(state);
  return {
    update,
    setAnimating(next: boolean) {
      if (next !== animating) {
        consecutiveFrames = 0;
        previousFrame = undefined;
      }
      animating = next;
      if (!next) {
        if (fps) fps.textContent = options.locale?.startsWith('fr') ? 'Pause' : 'Paused';
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(scheduled);
      resize.disconnect();
      vertexBuffer?.destroy();
      depth?.destroy();
      uniform.destroy();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    },
  };
}
