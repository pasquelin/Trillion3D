// Runs in the browser through Playwright serialization: one explorer per case, the image kept
// on `window` so two cases of the same context can be compared pixel for pixel (#274).
import type { FrameMetrics, SceneLight } from '../../../packages/sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/backendTypes.ts';
import type { MeasuredWorldOptions } from '../../../packages/sdk-browser/measurement.ts';

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
  /** Lights declared before the first frame, as the page under proof declares them: a cache
   *  whose own light table is empty is lit by its host or by nothing at all. */
  lights?: SceneLight[];
};

export async function runDefaultBackendCase(input: DefaultBackendCase) {
  const sdk = window.sdk;
  // One canvas per case: a canvas that once held a `GPUCanvasContext` can never hand out a
  // WebGL2 one, and the two cases of a machine open two different presentation paths.
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:480px;height:320px;display:block';
  document.body.append(canvas);
  const diagnostics: BackendDiagnostic[] = [];
  const base: MeasuredWorldOptions = {
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
  const options: MeasuredWorldOptions =
    input.request === 'witness'
      ? { ...base, backends: [sdk.referenceBackend, sdk.exactPagesBackend, sdk.threeLodBackend] }
      : input.request === 'autonomous'
        ? { ...base, autonomousGeometry: true }
        : base;
  /** What a case hands back, whether it rendered or failed to open at all. */
  type Result = {
    backend: string | null;
    error: string | null;
    /** Whether this context offered WebGPU at all, and the backend events it emitted. */
    webgpu: boolean;
    diagnostics: BackendDiagnostic[];
    /** Every backend the session mounted, not only the active one: a witness that never draws
     *  is still a witness the engine built. */
    mounted: string[];
    capabilities: unknown;
    metrics: Pick<
      FrameMetrics,
      | 'selectedTriangles'
      | 'submittedTriangles'
      | 'clusters'
      | 'drawCalls'
      | 'residentPages'
      | 'coverageReady'
      | 'frameHeld'
    > | null;
    /** rAF intervals per repeat, then the engine's own CPU frame cost over the same frames. */
    runs: number[][];
    cpuRuns: number[][];
  };
  const report = (part: Partial<Result> & Pick<Result, 'backend' | 'error'>): Result => {
    canvas.remove();
    return {
      mounted: [],
      capabilities: null,
      metrics: null,
      runs: [],
      cpuRuns: [],
      ...part,
      webgpu: !!navigator.gpu,
      diagnostics,
    };
  };
  let explorer: Awaited<ReturnType<typeof sdk.openMeasuredWorld>>;
  try {
    explorer = await sdk.openMeasuredWorld(canvas, options);
  } catch (error) {
    return report({ backend: null, error: String(error) });
  }
  for (const light of input.lights ?? []) explorer.addLight(light);
  const pose = explorer.pointsOfInterest()[0].pose;
  explorer.setPose(pose);
  await explorer.awaitPages();
  // The frame's own counters: `tri = selected` is read here, on the frame that is captured.
  const frame: FrameMetrics = explorer.render();
  await explorer.flush();
  (window.proof ??= { images: {} }).images[input.key] = Array.from(explorer.capture());
  // rAF cadence with one rendered frame per callback, on a camera that turns: a still scene
  // holds its frame by design, and a held frame times the composer instead of the engine. The
  // eye orbits the framing target by a milliradian per frame, far too little to change the cut.
  const dx = pose.position[0] - pose.target[0];
  const dz = pose.position[2] - pose.target[2];
  const turned = { ...pose, position: [...pose.position] as [number, number, number] };
  const orbit = (index: number) => {
    const angle = index * 0.001;
    turned.position[0] = pose.target[0] + dx * Math.cos(angle) - dz * Math.sin(angle);
    turned.position[2] = pose.target[2] + dx * Math.sin(angle) + dz * Math.cos(angle);
    explorer.setPose(turned);
  };
  const runs: number[][] = [];
  const cpuRuns: number[][] = [];
  for (let repeat = 0; repeat < input.repeats; repeat += 1) {
    const intervals: number[] = [];
    const cpu: number[] = [];
    await new Promise<void>((resolve) => {
      let previous = performance.now();
      let count = 0;
      const step = () => {
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        orbit(count);
        cpu.push((explorer.render() as FrameMetrics).cpuFrameMs);
        count += 1;
        if (count < input.frames) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    runs.push(intervals.slice(20)); // the first frames warm caches and pipelines
    cpuRuns.push(cpu.slice(20));
  }
  const backend = explorer.backend;
  const active = explorer.backends.find((one) => one.id === backend);
  const result = report({
    backend,
    error: null,
    mounted: explorer.backends.map((one) => one.id),
    capabilities: active?.capabilities ?? null,
    metrics: {
      selectedTriangles: frame.selectedTriangles,
      submittedTriangles: frame.submittedTriangles ?? null,
      clusters: frame.clusters,
      drawCalls: frame.drawCalls,
      residentPages: frame.residentPages,
      coverageReady: frame.coverageReady ?? null,
      frameHeld: frame.frameHeld ?? null,
    },
    runs,
    cpuRuns,
  });
  explorer.dispose();
  return result;
}
