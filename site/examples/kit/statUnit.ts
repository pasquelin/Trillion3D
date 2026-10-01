import { profileWindow, type ProfiledWorld } from './profile.ts';
import type { StatsSample } from './statsLines.ts';
import { labelOf } from './words.ts';

/** A duration as the kit prints it: milliseconds to two places. */
export const ms = (value: number) => `${value.toFixed(2)} ms`;

/** The CPU side of the corner, Unreal's `stat unit`: the frame's CPU time and its costliest named
 *  steps (`cpu…Ms` of the frame), each the median of the frames of the last half second. */
export interface CpuUnit {
  frameMs: number | null;
  steps: [name: string, ms: number][];
}

/** How many CPU steps and GPU passes the corner names: the costliest first. */
const UNIT_ROWS = 5;

/**
 * Where the frame's time went, as Unreal's `stat unit` shows it: the CPU frame and its costliest
 * named steps, then the costliest GPU passes by their own share (a pass's time less what an
 * earlier pass covered), the GPU time when the device gives no share. Nothing unmeasured shows.
 */
export function unitLines({
  cpu,
  gpuPassMs,
}: Pick<StatsSample, 'cpu' | 'gpuPassMs'>): [string, string][] {
  const lines: [string, string][] = [];
  if (cpu?.frameMs != null) lines.push(['CPU frame', ms(cpu.frameMs)]);
  for (const [name, value] of cpu?.steps ?? []) lines.push([`CPU ${name}`, ms(value)]);
  const passes = (gpuPassMs?.passes ?? [])
    .map(({ name, gpuMs, ownMs }): [string, number] => [name, ownMs ?? gpuMs ?? 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, UNIT_ROWS);
  for (const [name, value] of passes) lines.push([`GPU ${name}`, ms(value)]);
  return lines;
}

/** The median of a list, `null` when it is empty. */
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A named CPU step of the frame: `cpuShadowPlanMs` is `shadow plan`. */
const stepName = (key: string) => labelOf(key.slice(3, -2)).toLowerCase();

/**
 * The CPU side of the frames of a window, from each frame's own `cpu…Ms` values: the frame's
 * median and its costliest steps by median; `cpuFrameMs` and the sums (`cpuSubmitMs`) are the
 * frame, never a step beside its parts.
 */
export function cpuUnit(frames: readonly object[]): CpuUnit {
  const values = new Map<string, number[]>();
  for (const frame of frames)
    for (const [key, value] of Object.entries(frame))
      if (/^cpu[A-Z]\w*Ms$/.test(key) && typeof value === 'number' && Number.isFinite(value))
        (values.get(key) ?? values.set(key, []).get(key)!).push(value);
  const steps = [...values]
    .filter(([key]) => key !== 'cpuFrameMs' && key !== 'cpuSubmitMs')
    .map(([key, list]): [string, number] => [stepName(key), median(list) ?? 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, UNIT_ROWS);
  return { frameMs: median(values.get('cpuFrameMs') ?? []), steps };
}

/**
 * The engine's own CPU steps of the window since the last read, costliest by p95 first, each at
 * its median; the window opens again. `null` from an engine with no step profile (WebGL2), where
 * the frame's own `cpu…Ms` rank instead (`cpuUnit`).
 */
export function engineSteps(world: ProfiledWorld): [string, number][] | null {
  const engine = world.cpuSteps?.() ?? null;
  world.resetCpuSteps?.();
  if (!engine) return null;
  return profileWindow([], [], engine).steps.map(({ name, p50 }): [string, number] => [
    labelOf(name.replace(/Ms$/, '')).toLowerCase(),
    p50,
  ]);
}
