// One continuous navigation session with bounded stops at image checkpoints; no timing loop.
import type * as Sdk from '../../witnesses/measurement.ts';
import type { MeasureViewOptions } from '../measureOptions.ts';
import { walkTrajectory } from './trajectoryWalk.ts';
import { explorerOptions } from '../explorerPage.ts';
import { collecteDiagnostics, posterCapture } from '../measurePage.ts';

export async function captureTrajectory(
  options: MeasureViewOptions,
  indices: number[],
  captureArrival: boolean,
) {
  const sdk = (await import(options.sdkUrl)) as typeof Sdk;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const incidents: string[] = (globalThis.gpuIncidents = []);
  canvas.addEventListener('webglcontextlost', () => incidents.push('webglcontextlost'));
  const diagnostics = collecteDiagnostics(incidents);
  const explorer = await sdk.openMeasuredWorld(canvas, {
    ...explorerOptions(options, sdk.webgpuPagesBackend, null),
    onDiagnostic: diagnostics.onDiagnostic,
  });
  // Canvas readback samples the presented frame. The measurement seam's capture() requires
  // flush(), which converges streaming and can redraw internally: unsuitable for arrival frames.
  const surface = new OffscreenCanvas(canvas.width, canvas.height);
  const context = surface.getContext('2d')!;
  const capture = async (name: string) => {
    if (surface.width !== canvas.width || surface.height !== canvas.height)
      [surface.width, surface.height] = [canvas.width, canvas.height];
    context.setTransform(1, 0, 0, -1, 0, canvas.height); // Capture transport expects bottom-up rows.
    context.clearRect(0, 0, canvas.width, canvas.height); // Never blend over the last capture.
    context.drawImage(canvas, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const response = await posterCapture(
      name,
      new Uint8Array(rgba.buffer),
      canvas.width,
      canvas.height,
    );
    if (!response.ok) throw new Error(`capture rejected: ${name}`);
    return name;
  };
  try {
    for (const light of options.lights ?? []) explorer.addLight(light);
    explorer.setPose(options.pose);
    const run = await walkTrajectory(
      {
        render: (pose) => explorer.render(pose),
        capture,
        nextFrame: () => new Promise<void>((done) => requestAnimationFrame(() => done())),
      },
      options.poses ?? [],
      indices,
      options.captureFile,
      captureArrival,
    );
    return { ...run, incidents: [...incidents, ...run.incidents] };
  } finally {
    explorer.dispose();
    canvas.remove();
  }
}
