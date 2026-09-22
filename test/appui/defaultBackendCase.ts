// Runs in the browser through Playwright serialization: one explorer per case, the image kept
// on `window` so two cases of the same context can be compared pixel for pixel (#274).
import type { BackendDiagnostic } from '../../packages/sdk-browser/backendTypes.ts';
import type { ExplorerOptions } from '../../packages/sdk-browser/index.ts';

export type DefaultBackendCase = {
  manifestUrl: string;
  /** Key the capture is stored under, for the comparison that follows. */
  key: string;
  /** `default` asks for nothing; `witness` opens the pre-#274 list, active `exact-cluster-pages`;
   *  `autonomous` asks for the autonomous path explicitly, as a host could before this batch. */
  request: 'default' | 'witness' | 'autonomous';
  /** rAF-driven repeats, each of `frames` rendered frames; `0` only reads the selection. */
  repeats: number;
  frames: number;
};

export async function runDefaultBackendCase(input: DefaultBackendCase) {
  const sdk = window.sdk;
  // One canvas per case: a canvas that once held a `GPUCanvasContext` can never hand out a
  // WebGL2 one, and the two cases of a machine open two different presentation paths.
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:480px;height:320px;display:block';
  document.body.append(canvas);
  const diagnostics: BackendDiagnostic[] = [];
  const base: ExplorerOptions = {
    manifestUrl: input.manifestUrl,
    scope: 'full',
    width: 480,
    height: 320,
    pixelRatio: 1,
    temporalAntialiasing: false,
    pixelError: 0,
    onDiagnostic: (event) => {
      if (/^backend-/.test(event.phase)) diagnostics.push(event);
    },
  };
  const options: ExplorerOptions =
    input.request === 'witness'
      ? { ...base, backends: [sdk.referenceBackend, sdk.exactPagesBackend, sdk.threeLodBackend] }
      : input.request === 'autonomous'
        ? { ...base, autonomousGeometry: true }
        : base;
  const report = (backend: string | null, error: string | null, runs: number[][]) => {
    canvas.remove();
    return { backend, error, webgpu: !!navigator.gpu, diagnostics, runs };
  };
  let explorer: Awaited<ReturnType<typeof sdk.createExplorer>>;
  try {
    explorer = await sdk.createExplorer(canvas, options);
  } catch (error) {
    return report(null, String(error), []);
  }
  explorer.setPose(explorer.pointsOfInterest()[0].pose);
  await explorer.awaitPages();
  explorer.render();
  await explorer.flush();
  (window.proof ??= { images: {} }).images[input.key] = Array.from(explorer.capture());
  // rAF cadence with one rendered frame per callback: `invalidate()` renders on the manual path.
  const runs: number[][] = [];
  for (let repeat = 0; repeat < input.repeats; repeat += 1) {
    const intervals: number[] = [];
    await new Promise<void>((resolve) => {
      let previous = performance.now();
      let count = 0;
      const step = () => {
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        explorer.invalidate();
        count += 1;
        if (count < input.frames) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    runs.push(intervals.slice(20)); // the first frames warm caches and pipelines
  }
  const backend = explorer.backend;
  explorer.dispose();
  return report(backend, null, runs);
}

/** A stored capture as a PNG data URL, rows flipped: `capture()` hands back bottom-left origin. */
export function defaultBackendCapturePng(key: string) {
  const bytes = window.proof?.images[key];
  if (!bytes) throw new Error('unknown capture');
  const width = 480;
  const height = bytes.length / 4 / width;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const source = (height - 1 - row) * width * 4;
    for (let index = 0; index < width * 4; index += 1)
      image.data[row * width * 4 + index] = bytes[source + index];
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Pixels of a stored capture that differ from its corner pixel, the cleared background: a
 *  capture where the scene appears has many of them, an empty canvas has none (#298). */
export function countDrawnPixels(key: string) {
  const bytes = window.proof?.images[key];
  if (!bytes) throw new Error('unknown capture');
  let drawn = 0;
  for (let index = 0; index < bytes.length; index += 4)
    for (let channel = 0; channel < 4; channel += 1)
      if (bytes[index + channel] !== bytes[channel]) {
        drawn += 1;
        break;
      }
  return { drawn, totalPixels: bytes.length / 4 };
}

/** Pixels that differ between two stored captures, and the largest channel gap among them. */
export function compareDefaultBackendCaptures(pair: [string, string]) {
  const store = window.proof;
  const a = store?.images[pair[0]];
  const b = store?.images[pair[1]];
  if (!a || !b || a.length !== b.length) throw new Error('captures are not comparable');
  let differentPixels = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < a.length; index += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(a[index + channel] - b[index + channel]);
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > 0) differentPixels += 1;
    if (pixelDelta > maxChannelDelta) maxChannelDelta = pixelDelta;
  }
  return { differentPixels, maxChannelDelta, totalPixels: a.length / 4 };
}
