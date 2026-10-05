// A device drawing on a display, for the render-scale controller's tests (`scaleFit.test.ts`).
import type { ScaleControl } from './scaleControl.ts';

export const HZ120 = 1000 / 120;
export const HZ60 = 1000 / 60;

/** What a frame costs at scale `s`, frame `f`: `gpu` ms on the GPU, `other` ms outside its timer
 *  (compositing, the CPU); `still`: the image is a still one; `timed`: GPU times arrive, `lag`
 *  frames late. */
export interface Device {
  gpu: (s: number, f: number) => number;
  other?: (f: number) => number;
  still?: (f: number) => boolean;
  timed?: boolean;
  lag?: number;
  /** What the timer reports for a GPU time (`null`: a sample without a time); itself by default. */
  measured?: (ms: number) => number | null;
}

/**
 * Runs `frames` display frames of `device` on a display refreshing every `refresh` ms, as the engine
 * does (the interactive loop, `measureWebgpuFrame`): each frame ticks the control at its start; one
 * it holds to measure the refresh (`measuring`, `hold`) draws nothing and the next begins a refresh later; else its image, drawn at the
 * control's scale, is shown for the whole refreshes its GPU and other work span (one at least).
 * `clock` carries the time and the frame count from a
 * run to the next. Returns, per drawn frame, the refreshes its image was shown and its scale.
 */
export function simulate(
  control: ScaleControl,
  frames: number,
  device: Device,
  clock = { now: 0, frame: 0 },
  refresh = HZ120,
) {
  const shown: number[] = [],
    scales: number[] = [],
    queue: { ms: number; s: number }[] = [],
    timed = device.timed !== false;
  for (let i = 0; i < frames; i++, clock.frame++) {
    control.tick(clock.now, timed);
    if (control.measuring) {
      control.hold();
      clock.now += refresh;
      continue;
    }
    const f = clock.frame,
      s = control.wanted(),
      ms = device.gpu(s, f),
      still = device.still?.(f) ?? false,
      n = Math.max(1, Math.ceil((ms + (device.other?.(f) ?? 0)) / refresh - 1e-9));
    control.drew(s, true, still);
    clock.now += n * refresh;
    if (timed) {
      queue.push({ ms, s });
      while (queue.length > (device.lag ?? 2)) {
        const read = queue.shift()!;
        control.observe(device.measured ? device.measured(read.ms) : read.ms, read.s);
      }
    }
    shown.push(n);
    scales.push(s);
  }
  return { shown, scales };
}

/** The largest scale in `[min, 1]` whose frame, `g · s²` ms on the GPU and `other` outside it,
 *  fits one `refresh`. */
export const fitting = (g: number, other: number, min = 0.5, refresh = HZ120) =>
  Math.min(1, Math.max(min, Math.sqrt((refresh - other) / g)));

/** Ticks `control` at 120 Hz from `clock.now`, each image costing `gpuMs` on the GPU at the
 *  controller's scale, until the controller lowers it, 64 frames at most: the frames held to
 *  measure the refresh (`measuring`), then a cost over its target. Returns the clock. */
export function lowered(control: ScaleControl, gpuMs: number, clock = { now: 0, frame: 0 }) {
  const from = control.wanted();
  for (let i = 0; i < 64; i++, clock.frame++) {
    control.tick((clock.now += HZ120), true);
    // Lowered: no image is drawn at the new scale yet.
    if (control.wanted() < from) break;
    if (control.measuring) control.hold();
    else control.observe(gpuMs, control.wanted());
  }
  return clock;
}
