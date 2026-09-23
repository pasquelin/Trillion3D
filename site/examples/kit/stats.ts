import { hideable, overlay } from './overlay.ts';

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
  geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } };
  traverseVisible?: (visit: (node: SceneNode) => void) => void;
}

/** The world the corner watches: its frame hook and its scene. */
export interface StatsWorld {
  onFrame: (hook: (frame: { metrics: FrameCounters }) => void) => unknown;
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
 * so, when the frame reports none; a still image keeps its last rate, marked held.
 */
export function statLines(sample: StatsSample): [string, string][] {
  const lines: [string, string][] = [];
  if (sample.fps !== null)
    lines.push(['FPS', `${Math.round(sample.fps)}${sample.held ? ' held' : ''}`]);
  if (sample.selectedTriangles) lines.push(['triangles', count(sample.selectedTriangles)]);
  else if (sample.sceneTriangles) lines.push(['triangles (scene)', count(sample.sceneTriangles)]);
  if (sample.drawCalls) lines.push(['draw calls', count(sample.drawCalls)]);
  if (sample.residentPages) lines.push(['pages', count(sample.residentPages)]);
  if (sample.geometryPoolBytes)
    lines.push(['geometry pool', `${(sample.geometryPoolBytes / 2 ** 20).toFixed(1)} MiB`]);
  if (sample.lightsActive) lines.push(['lights', count(sample.lightsActive)]);
  if (sample.gpuFrameMs) lines.push(['GPU frame', `${sample.gpuFrameMs.toFixed(2)} ms`]);
  return lines;
}

/** Triangles of the visible meshes built in the scene: indexed, or three vertices each. */
export function sceneTriangles(scene: SceneNode): number {
  let total = 0;
  scene.traverseVisible?.((node) => {
    const shape = node.geometry;
    if (shape)
      total += Math.floor((shape.index?.count ?? shape.attributes?.position?.count ?? 0) / 3);
  });
  return total;
}

/**
 * A small corner at the bottom left of the example: the frames the world drew per second, and
 * the engine's counters of the last frame, refreshed twice a second.
 */
export function stats(world: StatsWorld) {
  const card = document.createElement('dl');
  card.className =
    'pointer-events-none absolute bottom-3 left-3 grid grid-cols-[auto_auto] gap-x-3 rounded-box bg-base-100/60 px-3 py-2 font-mono text-[11px] leading-4 opacity-90 backdrop-blur';
  overlay().append(card);
  hideable(card);
  const drawn: number[] = [];
  let last: FrameCounters = {},
    fps: number | null = null;
  world.onFrame(({ metrics }) => {
    drawn.push(performance.now());
    last = metrics;
  });
  setInterval(() => {
    const now = performance.now();
    while (drawn.length && drawn[0] < now - 1000) drawn.shift();
    // The rate is read from the intervals between the frames of the last second; with fewer
    // than two, the image stands still and the corner keeps the rate it last read.
    const held = drawn.length < 2;
    if (!held) fps = ((drawn.length - 1) * 1000) / (drawn[drawn.length - 1] - drawn[0]);
    const sample: StatsSample = { ...last, fps, held: held && fps !== null, sceneTriangles: null };
    if (!last.selectedTriangles) sample.sceneTriangles = sceneTriangles(world.scene);
    card.replaceChildren(
      ...statLines(sample).flatMap(([label, value]) => {
        const term = document.createElement('dt'),
          text = document.createElement('dd');
        term.className = 'opacity-70';
        term.textContent = label;
        text.className = 'text-right tabular-nums';
        text.textContent = value;
        return [term, text];
      }),
    );
  }, 500);
}
