// Page side of the anisotropy cost fixture (#360, #361): one textured floor seen at a grazing
// angle, drawn by the WebGPU engine from `dist/` at anisotropy 1 then 16, the GPU time of each
// image read from the engine's own timer. The camera slides by a hair at every image, so no image
// is held and each one pays its reads.
//
// This module is SERVED to the harness page (mount `/tests/`) and imported by its URL, like
// `materialPixelsPage.ts`.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { batisseur, engine, libere } from './sharedSceneProof.ts';
import { canvasMap } from './materialImages.ts';
import type { BackendFactory } from '../../../packages/sdk-browser/src/backend/types.ts';
import { median } from '../../kit/median.ts';
import type * as SdkBrowser from '../../../packages/sdk-browser/src/measurement/measurement.ts';

/** Half side of the floor, in scene units: the far edge reaches the horizon of the view. */
const HALF = 200;
/** Side of the floor's picture in texels, and how many times it repeats across the floor. */
const PICTURE = 1024,
  REPEAT = 64;

interface Reading {
  anisotropy: number;
  /** p50 of the image envelope, submit to done (`gpuFrameMs`). */
  frameMs: number | null;
  /** p50 of the sum of the timed passes, when the device has timestamp queries. */
  passesMs: number | null;
  samples: number;
}

const p50 = (values: number[]) => (values.length ? median(values) : null);

/** A picture with detail at every texel: a seeded noise, so the reads cannot share a cache line. */
function floorMap(anisotropy: number) {
  return canvasMap(
    PICTURE,
    (ctx) => {
      const image = ctx.createImageData(PICTURE, PICTURE);
      let seed = 1;
      for (let i = 0; i < image.data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        image.data[i] = (i & 3) === 3 ? 255 : seed >>> 24;
      }
      ctx.putImageData(image, 0, 0);
    },
    {
      colorSpace: G.HOST_COLOUR_SPACE_SRGB,
      wrapS: G.HOST_WRAP_REPEAT,
      wrapT: G.HOST_WRAP_REPEAT,
      repeat: REPEAT,
      anisotropy,
    },
  );
}

/** Frames of one anisotropy: warm-up images first, then the timed ones. */
async function measure(
  webgpuPagesBackend: BackendFactory,
  device: GPUDevice,
  anisotropy: number,
  size: [number, number],
  frames: number,
): Promise<Reading> {
  const builder = batisseur();
  const floor = G.mesh(
    G.planeGeometry(2 * HALF, 2 * HALF),
    G.basicSurface({ map: floorMap(anisotropy) }),
  );
  floor.rotation.x = -Math.PI / 2;
  builder.source.add(floor);
  builder.ajoute(floor, 'exact-clusters', HALF);
  const scene = builder.fini();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, () => {}, {
    viewport: size,
    stageProfile: true,
  });
  const camera = G.perspectiveCamera(55, size[0] / size[1], 0.1, 4 * HALF);
  const frameMs: number[] = [],
    passesMs: number[] = [];
  let lastSample = -1;
  try {
    await backend.prepare();
    const warmup = 30;
    for (let image = 0; image < warmup + frames; image++) {
      camera.position.set((image & 1) * 1e-3, 1, HALF * 0.9);
      camera.lookAt(0, 0.7, 0);
      camera.updateMatrixWorld(true);
      backend.render(camera);
      (backend as { cpuFrameEnd?: () => void }).cpuFrameEnd?.();
      await backend.flush!();
      const metrics = backend.metrics() as {
        gpuFrameMs?: number | null;
        gpuPassMs?: { frame: number; totalMs: number | null } | null;
      };
      const sample = metrics.gpuPassMs;
      if (image < warmup || !sample || sample.frame === lastSample) continue;
      lastSample = sample.frame;
      if (typeof metrics.gpuFrameMs === 'number') frameMs.push(metrics.gpuFrameMs);
      if (typeof sample.totalMs === 'number') passesMs.push(sample.totalMs);
    }
  } finally {
    libere(backend, canvas, scene);
  }
  return { anisotropy, frameMs: p50(frameMs), passesMs: p50(passesMs), samples: frameMs.length };
}

/** Runs the floor at each anisotropy, one engine at a time, on a device that times its passes
 *  when it can. */
export async function run({
  sdkUrl,
  anisotropies,
  size,
  frames,
}: {
  sdkUrl: string;
  anisotropies: number[];
  size: [number, number];
  frames: number;
}) {
  const { webgpuPagesBackend } = (await import(sdkUrl)) as typeof SdkBrowser;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'no WebGPU adapter' };
  const timed = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timed ? ['timestamp-query'] : [],
  });
  const readings: Reading[] = [];
  try {
    for (const anisotropy of anisotropies)
      readings.push(await measure(webgpuPagesBackend, device, anisotropy, size, frames));
  } finally {
    device.destroy();
  }
  const info = adapter.info;
  return { readings, timed, gpu: `${info?.vendor ?? ''} ${info?.architecture ?? ''}`.trim() };
}
