import type { ProfiledWorld } from './profile.ts';

/** What the stats corner reads of a frame: the engine's own counters, `null` when not measured. */
interface FrameCounters {
  selectedTriangles?: number | null;
  drawCalls?: number | null;
  residentPages?: number | null;
  geometryPoolBytes?: number | null;
  lightsActive?: number | null;
  gpuFrameMs?: number | null;
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
  fps: number | null;
  held: boolean;
  sceneTriangles: number | null;
}

const count = (value: number) => Math.round(value).toLocaleString('en');

/**
 * The lines the corner shows, label then value. A counter the engine did not measure has no
 * line at all, never a dash or a zero; the triangles fall back to the scene's own count, named
 * so, when the frame does not measure them; a still image keeps its last rate, marked held.
 */
export function statLines(sample: StatsSample): [string, string][] {
  const lines: [string, string][] = [];
  if (sample.fps !== null)
    lines.push(['FPS', `${Math.round(sample.fps)}${sample.held ? ' held' : ''}`]);
  if (sample.selectedTriangles) lines.push(['triangles', count(sample.selectedTriangles)]);
  else if (sample.selectedTriangles == null && sample.sceneTriangles)
    lines.push(['triangles (scene)', count(sample.sceneTriangles)]);
  if (sample.drawCalls) lines.push(['draw calls', count(sample.drawCalls)]);
  if (sample.residentPages) lines.push(['pages', count(sample.residentPages)]);
  if (sample.geometryPoolBytes)
    lines.push(['geometry pool', `${(sample.geometryPoolBytes / 2 ** 20).toFixed(1)} MiB`]);
  if (sample.lightsActive) lines.push(['lights', count(sample.lightsActive)]);
  if (sample.gpuFrameMs) lines.push(['GPU frame', `${sample.gpuFrameMs.toFixed(2)} ms`]);
  return lines;
}

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

/** Where the corner may sit: the bottom left by default, the top left for an example whose own
 *  display takes the bottom of the frame. */
export const statsCorners = { 'bottom-left': 'bottom-3 left-3', 'top-left': 'top-3 left-3' };

/** The corner's card, and the look of its labels and values: one look for the examples' corner
 *  and the scene editor's. */
export const STATS_CARD =
  'pointer-events-none absolute grid grid-cols-[auto_auto] gap-x-3 rounded-box bg-base-100/60 px-3 py-2 font-mono text-[11px] leading-4 opacity-90 backdrop-blur';
export const STATS_TERM = 'opacity-70';
export const STATS_VALUE = 'text-right tabular-nums';

/**
 * Watches `world`: counts the frames it draws and keeps the engine's counters of the last one,
 * and twice a second hands `show` the corner's lines — `extra` added — when they changed. Returns
 * what stops it.
 */
export function watchStats(
  world: StatsWorld,
  show: (lines: [string, string][]) => void,
  extra: () => [string, string][] = () => [],
) {
  const drawn: number[] = [];
  let last: FrameCounters = {},
    fps: number | null = null,
    shown = '';
  const unhook = world.onFrame(({ metrics }) => {
    drawn.push(performance.now());
    last = metrics;
  });
  const timer = setInterval(() => {
    const now = performance.now();
    while (drawn.length && drawn[0] < now - 1000) drawn.shift();
    // The rate is read from the intervals between the frames of the last second; with fewer
    // than two, the image stands still and the corner keeps the rate it last read.
    const held = drawn.length < 2;
    if (!held) fps = ((drawn.length - 1) * 1000) / (drawn[drawn.length - 1] - drawn[0]);
    const sample: StatsSample = { ...last, fps, held: held && fps !== null, sceneTriangles: null };
    if (last.selectedTriangles == null) sample.sceneTriangles = sceneTriangles(world.scene);
    const lines = [...statLines(sample), ...extra()],
      key = lines.join('\n');
    if (key === shown) return;
    shown = key;
    show(lines);
  }, 500);
  return () => {
    clearInterval(timer);
    if (typeof unhook === 'function') unhook();
  };
}
