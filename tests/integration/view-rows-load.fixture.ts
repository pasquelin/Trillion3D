// The child of `view-rows-load.test.ts` (#1232): one cooked world opened the way a page opens it
// (`openMeasuredWorld`), on WebGPU, on the mock device with an Apple M2's limits, at the boss's
// case (1728×1117 CSS pixels, DPR 2), under a memory cap. A renderer's memory holds the JS heap
// and its array buffers alike, and the tab dies past it; Node caps only the first
// (`--max-old-space-size`), so this process caps the sum itself, polled while the world opens and
// draws, and exits as out of memory past it. The mock device's own buffers and its log of writes
// stand for GPU memory, which the renderer does not hold: they are not counted.
//
//   node --max-old-space-size=<mb> tests/integration/view-rows-load.fixture.ts <manifest> <cap mb>
import { open, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installGpuGlobals } from '../kit/gpu/globals.ts';
import { mockGpu } from '../kit/gpu/mockGpu.ts';
import { openMeasuredWorld } from '../../packages/sdk-browser/src/world/session/explorer.ts';
import type { BackendDiagnostic } from '../../packages/sdk-browser/src/diagnostic/types.ts';

/** The exit code of a process that ran out of memory, as a killed renderer's. */
export const OUT_OF_MEMORY = 137;

/** An Apple M2's WebGPU limits, the ones the page asks for. */
const M2_LIMITS = {
  maxBufferSize: 1 << 30,
  maxStorageBufferBindingSize: 1 << 30,
  maxBindGroups: 8,
  maxComputeWorkgroupSizeX: 256,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupStorageSize: 32768,
  maxComputeWorkgroupsPerDimension: 65535,
  maxUniformBufferBindingSize: 1 << 28,
  maxTextureDimension2D: 16384,
  maxStorageTexturesPerShaderStage: 8,
  maxStorageBuffersPerShaderStage: 16,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
};
const [WIDTH, HEIGHT] = [1728 * 2, 1117 * 2];
const MB = 1 << 20;

/** A canvas of the boss's case whose WebGPU context presents into a mock texture; the WebGL2
 *  context the world probes answers every call. */
function canvasOf(device: GPUDevice) {
  const context = {
    configure() {},
    unconfigure() {},
    getCurrentTexture: () =>
      device.createTexture({ size: [WIDTH, HEIGHT], format: 'bgra8unorm', usage: 16 }),
  };
  const answers: Record<string, unknown> = {
    then: undefined, // not a promise
    isContextLost: () => false,
    getSupportedExtensions: () => ['EXT_color_buffer_half_float'],
    getExtension: (name: string) => (name === 'EXT_color_buffer_half_float' ? {} : null),
    checkFramebufferStatus: () => 1, // every constant is 1: complete
  };
  const gl = new Proxy(answers, {
    get: (_, key: string) =>
      key in answers ? answers[key] : /^[A-Z_0-9]+$/.test(key) ? 1 : () => ({}),
  });
  return {
    nodeName: 'CANVAS',
    width: WIDTH,
    height: HEIGHT,
    clientWidth: WIDTH / 2,
    clientHeight: HEIGHT / 2,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext: (kind: string) => (kind === 'webgpu' ? context : gl),
    ownerDocument: { defaultView: undefined },
  } as unknown as HTMLCanvasElement;
}

/** Opens `manifest` and draws until its first image is drawn, the renderer's memory under `capMb`:
 *  what it held at its peak, and how the image was cut. */
export async function openUnderCap(manifest: string, capMb: number) {
  installGpuGlobals();
  const gpu = mockGpu({ compute: true, limits: M2_LIMITS });
  const deviceBytes = () =>
    gpu.buffers.reduce((sum, buffer) => sum + buffer.size, 0) +
    gpu.writes.reduce((sum, write) => sum + write.bytes.byteLength, 0);
  let peak = 0;
  const poll = () => {
    const { heapUsed, arrayBuffers } = process.memoryUsage();
    peak = Math.max(peak, (heapUsed + arrayBuffers - deviceBytes()) / MB);
    if (peak <= capMb) return;
    process.stdout.write(`${JSON.stringify({ outOfMemory: true, peakMb: Math.round(peak) })}\n`);
    process.exit(OUT_OF_MEMORY);
  };
  const watch = setInterval(poll, 5);
  // A server as the page's: it answers a Range with that range alone (206), as a static server does.
  Object.assign(globalThis, {
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const href = input instanceof Request ? input.url : String(input);
      const type = /\.(json|gltf)$/.test(href) ? 'application/json' : 'application/octet-stream';
      const range = new Headers(input instanceof Request ? input.headers : init?.headers).get(
        'range',
      );
      const [from, to] = (/^bytes=(\d+)-(\d+)$/.exec(range ?? '') ?? []).slice(1).map(Number);
      if (range === null || to === undefined)
        return new Response(await readFile(fileURLToPath(href)), {
          headers: { 'content-type': type },
        });
      const file = await open(fileURLToPath(href));
      const { buffer, bytesRead } = await file.read(
        Buffer.alloc(to - from + 1),
        0,
        to - from + 1,
        from,
      );
      await file.close();
      return new Response(buffer.subarray(0, bytesRead), { status: 206 });
    },
  });
  const canvas = canvasOf(gpu.device);
  for (const [name, value] of Object.entries({
    location: { href: pathToFileURL(manifest).href },
    document: { getElementById: () => canvas, createElement: () => canvas },
  }))
    Object.defineProperty(globalThis, name, { value, configurable: true });
  const seen: { drawn?: unknown; cut?: string } = {};
  const onDiagnostic = ({ phase, context }: BackendDiagnostic) => {
    if (phase === 'first-render-path') seen.drawn = context;
    if (phase === 'gpu-selection-fallback') seen.cut = String(context?.reason);
  };
  const world = await openMeasuredWorld(canvas, {
    manifestUrl: pathToFileURL(manifest).href,
    scope: 'full',
    renderer: 'webgpu',
    gpuDevice: gpu.device,
    width: WIDTH,
    height: HEIGHT,
    onDiagnostic,
  });
  for (let image = 0; image < 40 && !seen.drawn; image++) {
    await world.render();
    poll();
    await new Promise((settle) => setTimeout(settle, 10));
  }
  poll();
  clearInterval(watch);
  world.dispose();
  return { drawn: !!seen.drawn, cut: seen.cut ?? 'gpu', peakMb: Math.round(peak) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [manifest, cap] = process.argv.slice(2);
  const result = await openUnderCap(manifest, Number(cap));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
