// Run IN THE PAGE by `page.evaluate` (emeraude-webgpu.browser.ts): serialised via `toString()`,
// so nothing here may close over an outer Node import — only its own parameters and browser
// globals (`window`, `document`, `navigator`). Kept as a named, explicitly typed function so its
// return type is a real structural type instead of collapsing to `any` through `import(sdkUrl)`.
import type { BackendDiagnostic } from '../../packages/sdk-browser/backendTypes.ts';

// `window.saveImage` is installed by `page.exposeFunction` in the caller; declared here so this
// module (type-checked, though it runs in the browser) sees it.
declare global {
  interface Window {
    saveImage: (name: string, data: string) => Promise<void>;
  }
}

/** One trajectory point read on one backend: the engine's own render metrics, the readback
 * against a live capture, and (for the second backend) the pixel difference against the first. */
export interface EmeraldReading {
  id: string;
  segment: number;
  pose: unknown;
  sourceKey: string;
  metrics: Record<string, unknown>;
  captureMax: number;
  captureDiff: number;
  diff: {
    mae: number;
    max: number;
    differentPixels: number;
    foregroundMae: number;
    foregroundPixels: number;
  } | null;
}

/** Both backends drawn along the trajectory, read back and compared. */
export async function runOnPage({
  sdkUrl,
  posesUrl,
  temporalAntialiasing,
  ...viewport
}: {
  sdkUrl: string;
  posesUrl: string;
  temporalAntialiasing: boolean;
  width: number;
  height: number;
}) {
  const { createExplorer, referenceBackend, webgpuPagesBackend } = await import(sdkUrl);
  const { poseAt, PATH_POSES, FRAMES_PER_SEGMENT } = await import(posesUrl);
  const backends = {
    'three-webgl-reference': referenceBackend,
    'webgpu-page-raster': webgpuPagesBackend,
  };
  const results: EmeraldReading[] = [],
    images: Uint8Array[] = [],
    events: (BackendDiagnostic & { id: string })[] = [];
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter');
  const gpu = {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
    description: adapter.info.description,
  };
  const read = (canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2'),
      p = new Uint8Array(canvas.width * canvas.height * 4);
    if (gl) {
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return p;
    }
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(canvas, 0, 0);
    const top = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 0; y < canvas.height; y++)
      p.set(
        top.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4),
        (canvas.height - 1 - y) * canvas.width * 4,
      );
    return p;
  };
  for (const id of ['three-webgl-reference', 'webgpu-page-raster'] as const) {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const e = await createExplorer(canvas, {
      manifestUrl: '/benchmark-assets/emerald-square-derived/native/full/manifest.json',
      scope: 'full',
      ...viewport,
      pixelError: 1,
      maxResidentPages: 100000,
      preload: 'visible',
      backends: [backends[id]],
      textureSource: id === 'webgpu-page-raster' ? 'cache' : 'host', // the witness keeps its images
      temporalAntialiasing,
      clearColor: 0x2a303c,
      onDiagnostic: (event: BackendDiagnostic) => events.push({ id, ...event }),
    });
    e.select(id);
    // One pose per trajectory point: the first frame of each segment.
    for (let i = 0; i * FRAMES_PER_SEGMENT < PATH_POSES; i++) {
      const pose = poseAt(e.bounds, i * FRAMES_PER_SEGMENT);
      e.setPose(pose);
      await e.awaitPages();
      // Warmup: an engine that publishes `frameHeld` renders until the held image — a full
      // cycle of still frames after the last texture arrival, 64 at most: at 24, eight poses
      // in ten were recorded before convergence — the witness four frames as always.
      let metrics = { ...e.render() };
      for (let w = 1; w < ('frameHeld' in metrics ? 64 : 4) && !metrics.frameHeld; w++) {
        await e.flush();
        metrics = { ...e.render() };
      }
      await e.flush();
      metrics = { ...e.render() };
      const pixels = read(canvas);
      await window.saveImage(id + '-' + i, canvas.toDataURL());
      const capture = e.capture();
      let captureMax = 0,
        captureDiff = 0;
      for (let p = 0; p < pixels.length; p++) {
        let d = Math.abs(pixels[p] - capture[p]);
        captureMax = Math.max(d, captureMax);
        if (d > 2) captureDiff++;
      }
      let diff = null;
      if (id === 'three-webgl-reference') images.push(pixels);
      else {
        const ref = images[i];
        let sum = 0,
          max = 0,
          count = 0,
          fgCount = 0,
          fgSum = 0;
        for (let p = 0; p < ref.length; p += 4) {
          let changed = false;
          const fg = ref[p] !== 42 || ref[p + 1] !== 48 || ref[p + 2] !== 60;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(ref[p + c] - pixels[p + c]);
            sum += d;
            max = Math.max(max, d);
            if (d > 2) changed = true;
            if (fg) fgSum += d;
          }
          if (fg) fgCount++;
          if (changed) count++;
        }
        diff = {
          mae: sum / ((ref.length / 4) * 3),
          max,
          differentPixels: count,
          foregroundMae: fgSum / (fgCount * 3),
          foregroundPixels: fgCount,
        };
      }
      results.push({
        id,
        segment: i,
        pose,
        sourceKey: e.metadata.key,
        metrics,
        captureMax,
        captureDiff,
        diff,
      });
    }
    e.dispose();
    canvas.remove();
  }
  return { results, events, gpu, userAgent: navigator.userAgent };
}
