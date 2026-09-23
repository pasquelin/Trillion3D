// Imported BY THE PAGE, served under `/support/` (`benchPage.ts`): the bench scene opened the way
// the shadow proofs read it, and the settling loop they share. Nothing here runs in Node.
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';

/**
 * Opens the bench scene in a canvas of the page: this tree's engine, one pixel of error, no
 * antialiasing, every page it asks for admitted. `options` adds to or overrides these.
 */
export async function openBenchWorld(
  id: string,
  sdkUrl: string,
  manifestUrl: string,
  [width, height]: [number, number],
  options: Record<string, unknown> = {},
): Promise<MeasuredWorld> {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.style.cssText = `width:${width}px;height:${height}px;display:block`;
  document.body.style.margin = '0';
  document.body.append(canvas);
  const { openMeasuredWorld, webgpuPagesBackend } = await import(sdkUrl);
  return openMeasuredWorld(id, {
    manifestUrl,
    scope: 'full',
    interactive: false,
    backends: [webgpuPagesBackend],
    width,
    height,
    pixelRatio: 1,
    pixelError: 1,
    maxResidentPages: 100000,
    textureSource: 'cache',
    temporalAntialiasing: false,
    ...options,
  });
}

/** Renders and flushes `pose` until the frame is held: its metrics then, or null if it never is. */
export async function settleWorld(scene: MeasuredWorld, pose: unknown) {
  for (let i = 0; i < 128; i++) {
    const metrics = scene.render(pose as never);
    await scene.flush();
    await scene.awaitPages();
    if (metrics.frameHeld) return metrics;
  }
  return null;
}
