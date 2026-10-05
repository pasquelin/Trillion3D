import type { Engine } from './engineTypes.ts';
import type { ProfiledWorld } from './profile.ts';
import { ms } from './statUnit.ts';
import type { Cadence } from './cadence.ts';
import type { StatsCorner } from './statsLayout.ts';
import { language } from './words.ts';

/** What the stats corner reads of a frame: the engine's own counters, `null` when not measured.
 *  Any other counter the frame publishes rides along under its own name (`shadowLines`). */
export interface FrameCounters {
  selectedTriangles?: number | null;
  drawCalls?: number | null;
  residentPages?: number | null;
  geometryPoolBytes?: number | null;
  lightsActive?: number | null;
  /** The GPU memory the engine holds, all and by kind (`MEMORY`). */
  gpuAllocatedBytes?: number | null;
  gpuFrameTargetBytes?: number | null;
  shadowPoolBytes?: number | null;
  geometryPoolAllocatedBytes?: number | null;
  texturePoolBytes?: number | null;
  textureLiveBytes?: number | null;
  transmissionBackdropBytes?: number | null;
  gpuFrameMs?: number | null;
  /** The frame's GPU passes, each with its own share where the device has timestamps. */
  gpuPassMs?: { passes: NonNullable<Engine.FrameMetrics['gpuPassMs']>['passes'] } | null;
  /** The frame's CPU time on the main thread. */
  cpuFrameMs?: number | null;
  /** The display's cadence and the device's idle between two images (`cadence.ts`). */
  rafIntervalMs?: number | null;
  displayRefreshMs?: number | null;
  gpuIdleMs?: number | null;
}

/** A node of the scene as far as counting its triangles goes. */
interface SceneNode {
  visible?: boolean;
  /** What the geometry draws: `triangles` for a mesh, points or lines otherwise. */
  primitive?: string;
  geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } };
  traverseVisible?: (visit: (node: SceneNode) => void) => void;
}

/** The world the corner watches: its frame hook and its scene; under `?profile`, its CPU steps. */
export interface StatsWorld extends ProfiledWorld<{ metrics: FrameCounters }> {
  scene: SceneNode;
}

/** One reading of the corner: every counter measured, or `null` when it was not. */
export interface StatsSample extends FrameCounters {
  /** Frames a second over the last second; `null` before the first rate and while `held`. */
  fps: number | null;
  held: boolean;
  /** True before the first sample, from a held image until the next device sample, without
   *  `timestamp-query`, or on WebGL2: `gpuFrameMs` is the last one measured. */
  gpuFrameLast?: boolean;
  sceneTriangles: number | null;
  /** The CPU side of the half second: the frame's median and each stage (`statUnit.ts`). */
  cpu?: { frameMs: number | null; stages: [name: string, ms: number][] };
  /** How the last second's frames held the display, `null` before it is measured (`cadence.ts`). */
  cadence?: Cadence | null;
}

/** A counter as the corner prints it: rounded, grouped in the page's language. */
const count = (value: number) => Math.round(value).toLocaleString(language());
/** Bytes as the corner prints them: in MiB, one decimal. */
const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

/** The GPU memory the engine publishes, all then by kind, under the corner's English label. */
const MEMORY = [
  ['GPU memory', 'gpuAllocatedBytes'],
  ['screen images', 'gpuFrameTargetBytes'],
  ['shadow memory', 'shadowPoolBytes'],
  ['geometry memory', 'geometryPoolAllocatedBytes'],
  ['texture memory', 'texturePoolBytes'],
  ['live textures', 'textureLiveBytes'],
  ['transmission backdrop', 'transmissionBackdropBytes'],
] as const satisfies readonly (readonly [string, keyof FrameCounters])[];
const MEMORY_KEYS: ReadonlySet<string> = new Set(MEMORY.map(([, key]) => key));

/** A counter's value as the corner prints it, by its name's unit: a duration (`…Ms`) in ms, a
 *  size (`…Bytes`) in MiB, any other a count. */
export const counterValue = (key: string, value: number) =>
  key.endsWith('Ms') ? ms(value) : key.endsWith('Bytes') ? mib(value) : count(value);

/**
 * The shadow counters of a frame, read from the names the engine publishes (`shadow…`), with
 * their numbers: a counter measured shows, zero included — zero is what a still scene must read —,
 * and one the engine does not hold (`null`, or absent) has none. The shadows' share of the GPU
 * memory is the memory lines' (`MEMORY`), not theirs. */
export function shadowCounters(frame: object): [key: string, value: number][] {
  const counters: [string, number][] = [];
  for (const [key, value] of Object.entries(frame))
    if (/^shadows?[A-Z]/.test(key) && typeof value === 'number' && !MEMORY_KEYS.has(key))
      counters.push([key, value]);
  return counters;
}

/** The scene and memory counters of the corner: triangles (the scene's own count, named so, when
 *  the frame does not measure them), draw calls, pages, pool, lights, then the GPU memory all and
 *  by kind (`MEMORY`), each only when the engine publishes it: never a dash, never a zero. */
export function sceneLines(sample: StatsSample): [string, string][] {
  const lines: [string, string][] = [];
  if (sample.selectedTriangles) lines.push(['triangles', count(sample.selectedTriangles)]);
  else if (sample.selectedTriangles == null && sample.sceneTriangles)
    lines.push(['triangles (scene)', count(sample.sceneTriangles)]);
  if (sample.drawCalls) lines.push(['draw calls', count(sample.drawCalls)]);
  if (sample.residentPages) lines.push(['pages', count(sample.residentPages)]);
  if (sample.geometryPoolBytes) lines.push(['geometry pool', mib(sample.geometryPoolBytes)]);
  if (sample.lightsActive) lines.push(['lights', count(sample.lightsActive)]);
  for (const [label, key] of MEMORY) {
    const bytes = sample[key];
    if (bytes) lines.push([label, mib(bytes)]);
  }
  return lines;
}

/** Frames a second from the times frames were drawn, in ms: `null` from fewer than two. */
export const rate = (times: readonly number[]) =>
  times.length < 2 ? null : ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);

/** Triangles of the visible meshes built in the scene: indexed, or three vertices each. Points
 *  and lines draw no triangle. */
export function sceneTriangles(scene: SceneNode): number {
  let total = 0;
  scene.traverseVisible?.((node) => {
    const shape = node.geometry;
    if (shape && (node.primitive ?? 'triangles') === 'triangles')
      total += Math.floor((shape.index?.count ?? shape.attributes?.position?.count ?? 0) / 3);
  });
  return total;
}

/** The classes of each corner the panel may sit in, for the examples' card (`statsCard`). */
export const statsCorners: Record<StatsCorner, string> = {
  'bottom-left': 'bottom-3 start-3',
  'top-left': 'top-3 start-3',
  'bottom-right': 'bottom-3 end-3',
  'top-right': 'top-3 end-3',
};

/** The corner's card, and the look of its labels and values: one look for the examples' corner
 *  and the scene editor's. */
export const STATS_CARD =
  'pointer-events-none absolute grid grid-cols-[auto_auto] gap-x-3 rounded-box bg-base-100/60 px-3 py-2 font-mono text-[11px] leading-4 opacity-90 backdrop-blur';
export const STATS_TERM = 'opacity-70';
export const STATS_VALUE = 'text-end tabular-nums';
