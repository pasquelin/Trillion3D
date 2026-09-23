import { compareImages, frameStatistics, summarize } from '../../../sdk-core/src/index.ts';
import type {
  CameraPose,
  FrameMetrics,
  PreparationProgress,
  StablePreview,
} from '../../../sdk-core/src/index.ts';
import { nextFrame } from '../frame/scheduling.ts';
import type { MeasuredWorld } from '../world/session/explorer.ts';

/** Caller supplies immutable poses: every backend gets exactly the same trajectory. */
export async function runCameraPath(
  explorer: MeasuredWorld,
  path: readonly CameraPose[],
  options: {
    backendIds?: string[];
    warmup?: number;
    signal?: AbortSignal;
    onPreparation?: (event: PreparationProgress) => void;
    onPreview?: (preview: StablePreview) => void;
  } = {},
) {
  if (explorer.diagnostic !== 'beauty') throw new Error('Campaign requires beauty mode');
  if (!path.length || path.length > 6000) throw new Error('Path must contain 1..6000 poses');
  const warmup = options.warmup ?? 4;
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 600) throw new Error('Invalid warmup');
  const ids = options.backendIds ?? explorer.backends.map((b) => b.id);
  if (
    ids.length < 2 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !explorer.backends.some((b) => b.id === id))
  )
    throw new Error('Select at least two unique available backends');
  const campaignSignal = options.signal ?? new AbortController().signal;
  const savedBackend = explorer.backend,
    savedCamera = explorer.camera.clone();
  explorer.setMeasurementSurface(true);
  try {
    const blocks: Array<{
        backend: string;
        frames: FrameMetrics[];
        cpu: ReturnType<typeof summarize>;
        cadence: ReturnType<typeof frameStatistics>;
      }> = [],
      quality: Array<{
        backend: string;
        pose: number;
        foreground: number;
        repeat: ReturnType<typeof compareImages>;
        image: ReturnType<typeof compareImages>;
      }> = [];
    const notify = (phase: string, completed: number, total: number, message: string) => {
      campaignSignal.throwIfAborted();
      options.onPreparation?.({ phase, completed, total, message });
    };
    // Exact A/A/candidate gate at every measured pose. No image capture during timed blocks.
    for (let i = 0; i < path.length; i++) {
      notify('verify', i, path.length, 'Exact pixel comparison');
      explorer.select(ids[0]);
      explorer.setPose(path[i]);
      await explorer.awaitPages();
      explorer.render();
      await explorer.flush();
      const a = explorer.capture();
      explorer.render();
      await explorer.flush();
      const aa = explorer.capture();
      const repeat = compareImages(a, aa);
      let foreground = 0;
      for (let pixel = 0; pixel < a.length; pixel += 4)
        if (a[pixel] !== a[0] || a[pixel + 1] !== a[1] || a[pixel + 2] !== a[2]) foreground++;
      if (i === 0)
        options.onPreview?.({
          scope: explorer.metadata.scope,
          origin: 'bottom-left',
          rgba: a.slice(),
          width: explorer.canvas.width,
          height: explorer.canvas.height,
          backend: ids[0],
        });
      for (const id of ids.slice(1)) {
        explorer.select(id);
        await explorer.awaitPages();
        explorer.render();
        await explorer.flush();
        const image = compareImages(a, explorer.capture());
        quality.push({ backend: id, pose: i, foreground, repeat, image });
        const epsilon = explorer.backends
          .find((b) => b.id === id)
          ?.capabilities.renderer.includes('WebGPU')
          ? 2
          : 0;
        if (!foreground || repeat.differentPixels || image.maxChannelError > epsilon)
          return {
            status: 'not-run' as const,
            reason: 'Exact image gate failed; no timing campaign',
            quality,
            blocks,
          };
      }
      await nextFrame(campaignSignal);
    }
    // Forward then reverse generalizes ABBA to N backends without favoring an endpoint.
    for (const id of [...ids, ...[...ids].reverse()]) {
      explorer.select(id);
      for (let i = 0; i < warmup; i++) {
        await nextFrame(campaignSignal);
        explorer.render(path[i % path.length]);
      }
      const frames: FrameMetrics[] = [];
      let previous: number | null = null;
      for (let i = 0; i < path.length; i++) {
        notify('measure', i, path.length, `Mesure : ${id}`);
        const raf = await nextFrame(campaignSignal);
        const frame = { ...explorer.render(path[i]) };
        frame.rafIntervalMs = previous === null ? null : raf - previous;
        previous = raf;
        frames.push(frame);
      }
      blocks.push({
        backend: id,
        frames,
        cpu: summarize(frames.map((f) => f.cpuFrameMs)),
        cadence: frameStatistics(
          frames.flatMap((f) => (f.rafIntervalMs === null ? [] : [f.rafIntervalMs])),
        ),
      });
    }
    return {
      status: 'measured' as const,
      reason: 'Exact resident cluster comparison only; no general performance verdict',
      quality,
      blocks,
    };
  } finally {
    explorer.restoreAfterCampaign(savedBackend, savedCamera);
  }
}
