// Run IN THE PAGE by `page.evaluate` (../renders/geometry-network.browser.ts): serialised via
// `toString()`, so nothing here may close over an outer Node import — only its own parameters and
// browser globals.
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts';

/** What one opening of the scene read: the pages the GPU pool admitted while the camera stood
 *  still, in order, the horizons the view ahead looked at while it moved, and what failed. */
export interface NetworkReading {
  admitted: string[];
  horizons: number[];
  failures: string[];
  held: boolean;
}

/** Opens `manifestUrl` on the WebGPU pages backend at pose 0 and renders until the image is held,
 *  giving up after `holdMs` of wall time, then walks the trajectory up to pose `poses`, one pose a frame. */
export async function readOverNetwork({
  sdkUrl,
  posesUrl,
  manifestUrl,
  poses,
  holdMs,
  width,
  height,
}: {
  sdkUrl: string;
  posesUrl: string;
  manifestUrl: string;
  poses: number;
  holdMs: number;
  width: number;
  height: number;
}): Promise<NetworkReading> {
  const { openMeasuredWorld, webgpuPagesBackend } = await import(sdkUrl);
  const { poseAt } = await import(posesUrl);
  const admitted: string[] = [],
    horizons: number[] = [],
    failures: string[] = [];
  let moving = false;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const world = await openMeasuredWorld(canvas, {
    manifestUrl,
    scope: 'full',
    width,
    height,
    pixelError: 1,
    backends: [webgpuPagesBackend],
    textureSource: 'cache',
    temporalAntialiasing: false,
    diagnosticDetail: 'trace',
    onDiagnostic: ({ phase, context }: BackendDiagnostic) => {
      // The pool's own record of a page written into a slot: the admission, in its order.
      if (phase === 'cache-gpu-page-upload') {
        if (!moving) admitted.push(String(context?.key));
      } else if (phase === 'gpu-selection-current-frame') {
        if (moving) horizons.push(Number(context?.aheadHorizonMs));
        // A record the bounded channel dropped (`diagnostic-loss`) would hide an admission.
      } else if (/failed|lost|loss/.test(phase)) failures.push(phase);
    },
  });
  world.select('webgpu-page-raster');
  const frame = async () => {
    const metrics = world.render();
    await world.flush();
    return metrics;
  };
  world.setPose(poseAt(world.bounds, 0));
  const until = performance.now() + holdMs;
  let metrics = await frame();
  while (!metrics.frameHeld && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    metrics = await frame();
  }
  const held = metrics.frameHeld;
  moving = true;
  for (let pose = 1; pose <= poses; pose++) {
    world.setPose(poseAt(world.bounds, pose));
    await frame();
  }
  world.dispose();
  canvas.remove();
  return { admitted, horizons, failures, held };
}
