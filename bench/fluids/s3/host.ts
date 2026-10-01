import { createGpuTiming } from '../../../packages/sdk-browser/src/gpu/timing/timing.ts';
import { createWebglFrameTimer } from '../../../packages/sdk-browser/src/webgl/core/frameTimer.ts';
import type { S3Result } from './contracts.ts';
import { recordGpuSample } from './samples.ts';

/** Browser resources and the existing asynchronous timers; no readback is awaited in a frame. */
export async function openHost(
  canvas: HTMLCanvasElement,
  backend: 'webgpu' | 'webgl2',
  result: S3Result,
) {
  if (backend === 'webgl2') {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    result.renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    const timer = createWebglFrameTimer(gl);
    result.capabilities = {
      extensions: gl.getSupportedExtensions(),
      timestampQuery: timer.supported,
    };
    let frame = 0,
      valid = 0,
      invalid = 0,
      lost = false;
    const reasons: Record<string, number> = {};
    const loss = () => {
      lost = true;
    };
    canvas.addEventListener('webglcontextlost', loss);
    if (gl.getError() !== gl.NO_ERROR) {
      canvas.removeEventListener('webglcontextlost', loss);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw new Error('WebGL2 initialization error');
    }
    const poll = () => {
      const read = timer.poll();
      const reason = read.reason ?? read.passes.find((pass) => pass.reason)?.reason;
      if (reason && reason !== 'no pending query' && reason !== 'result not ready yet') {
        invalid++;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      if (read.ms !== null && read.frame !== null) {
        valid++;
        if (read.frame >= result.options.warmup)
          result.gpuFrameMs.push({ frame: read.frame - result.options.warmup, ms: read.ms });
      }
    };
    return {
      gl,
      device: undefined,
      format: undefined,
      view: () => undefined,
      begin(index: number) {
        if (lost) throw new Error('WebGL2 context lost');
        frame = index;
        poll();
        timer.begin(frame);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.clearColor(0.02, 0.03, 0.04, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return undefined;
      },
      end() {
        timer.end();
        gl.flush();
      },
      async finish() {
        // Bounded polling outside the measured loop; never wait synchronously for a query.
        for (let i = 0; i < 8; i++) {
          await nextFrame();
          poll();
        }
        result.gpuTiming = {
          supported: timer.supported,
          reason: timer.reason,
          validSamples: valid,
          invalidSamples: invalid,
          invalidReasons: reasons,
          requestedFrames: frame + 1,
          instrument: 'whole-frame elapsed query',
        };
        if (lost || gl.getError() !== gl.NO_ERROR)
          throw new Error('WebGL2 context lost or validation error');
      },
      dispose() {
        canvas.removeEventListener('webglcontextlost', loss);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  }
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const timestamp = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamp ? ['timestamp-query'] : [],
  });
  const context = canvas.getContext('webgpu');
  if (!context) {
    device.destroy();
    throw new Error('WebGPU canvas unavailable');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  device.pushErrorScope('validation');
  context.configure({ device, format, alphaMode: 'opaque' });
  const info = adapter.info;
  result.device = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
  result.renderer = info.description || info.device || 'WebGPU';
  result.capabilities = {
    timestampQuery: timestamp,
    adapterFeatures: [...adapter.features],
    deviceFeatures: [...device.features],
  };
  const timer = createGpuTiming(device, {
    sampleEveryFrames: 1,
    onSample: (sample) => recordGpuSample(result, sample),
  });
  const color: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: { r: 0.02, g: 0.03, b: 0.04, a: 1 },
  };
  const clear: GPURenderPassDescriptor = { label: 'S3 control clear', colorAttachments: [color] };
  const commands = [undefined as unknown as GPUCommandBuffer];
  const metadata = {};
  let encoder: GPUCommandEncoder;
  let output: GPUTextureView;
  let lost: string | null = null;
  const validation: string[] = [];
  const uncaptured = (event: GPUUncapturedErrorEvent) => {
    validation.push(event.error.message);
  };
  device.addEventListener('uncapturederror', uncaptured);
  void device.lost.then((reason) => {
    lost = reason.message;
  });
  return {
    gl: undefined,
    device,
    format,
    view: () => output,
    begin(index: number) {
      if (lost !== null) throw new Error(`WebGPU device lost: ${lost}`);
      encoder = timer.createEncoder(index);
      output = context.getCurrentTexture().createView();
      color.view = output;
      const pass = encoder.beginRenderPass(clear);
      pass.end();
      return encoder;
    },
    end() {
      commands[0] = encoder.finish();
      device.queue.submit(commands);
      timer.submitted(encoder, metadata);
    },
    async finish() {
      await timer.flush();
      await device.queue.onSubmittedWorkDone();
      const scoped = await device.popErrorScope();
      if (scoped) validation.push(scoped.message);
      if (lost !== null || validation.length) throw new Error(lost ?? validation.join('; '));
      result.gpuTiming = { ...timer.stats(), instrument: 'earliest-to-latest pass timestamps' };
    },
    dispose() {
      device.removeEventListener('uncapturederror', uncaptured);
      timer.dispose();
      context.unconfigure();
      device.destroy();
    },
  };
}
export const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export type S3Host = Awaited<ReturnType<typeof openHost>>;
