// One continuous navigation session with bounded stops at image checkpoints; no timing loop.
import type * as Sdk from '../witnesses/measurement.ts';
import type { MeasureViewOptions } from './measureOptions.ts';
import type { TrajectoryCheckpoint } from './trajectoryProof.ts';
import { explorerOptions } from './explorerPage.ts';
import { collecteDiagnostics, poseCalme, posterCapture } from './measurePage.ts';

export async function captureTrajectory(options: MeasureViewOptions, indices: number[]) {
  const sdk = (await import(options.sdkUrl)) as typeof Sdk;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const incidents: string[] = (globalThis.incidentsGpu = []);
  canvas.addEventListener('webglcontextlost', () => incidents.push('webglcontextlost'));
  const diagnostics = collecteDiagnostics(incidents);
  const explorer = await sdk.openMeasuredWorld(canvas, {
    ...explorerOptions(options, sdk.webgpuPagesBackend, null),
    onDiagnostic: diagnostics.onDiagnostic,
  });
  const checkpoints: TrajectoryCheckpoint[] = [];
  const coverageFailures: number[] = [];
  let drawn = false;
  const check = (frame: ReturnType<typeof explorer.render>, index: number) => {
    if (frame.streamingError) incidents.push(frame.streamingError);
    if (
      frame.uncoveredTriangles !== 0 ||
      typeof frame.drawnTriangles !== 'number' ||
      frame.drawnTriangles !== frame.selectedTriangles
    )
      coverageFailures.push(index);
    if (typeof frame.drawnTriangles === 'number' && frame.drawnTriangles > 0) drawn = true;
  };
  const capture = async (name: string) => {
    const response = await posterCapture(name, explorer.capture(), canvas.width, canvas.height);
    if (!response.ok) throw new Error(`capture rejected: ${name}`);
    return name;
  };
  try {
    for (const light of options.lights ?? []) explorer.addLight(light);
    explorer.setPose(options.pose);
    if ((await poseCalme(explorer, options.pose)) === null)
      throw new Error('initial pose did not settle within 64 frames');
    for (const [index, pose] of (options.poses ?? []).entries()) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      const frame = explorer.render(pose);
      // No network drain while moving: residency and temporal history cross every segment.
      await explorer.flush();
      check(frame, index);
      if (!indices.includes(index)) continue;
      const prefix = `${options.captureFile}-${index}`;
      const arrival =
        options.captureFile === 'candidate' ? await capture(`${prefix}-arrival.png`) : null;
      const settleFrames = await poseCalme(explorer, pose);
      check(explorer.render(pose), index);
      await explorer.flush();
      checkpoints.push({
        index,
        arrival,
        settleFrames,
        settled: await capture(`${prefix}-settled.png`),
        pagesRequested: frame.pagesRequested ?? null,
        residentPages: frame.residentPages ?? null,
      });
    }
    return { checkpoints, coverageFailures, drawn, incidents };
  } finally {
    explorer.dispose();
    canvas.remove();
  }
}
