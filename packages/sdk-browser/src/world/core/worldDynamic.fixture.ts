import assert from 'node:assert/strict';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import type { MeasuredWorldOptions } from '../session/options.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

/** A world on a session stand-in that takes every rewrite in place; `served` counts its pages,
 *  `placed` the row ranges sent it (`updatePlacements`).
 *  `frame` draws as a host's `render()` does, `loop` as the session's own loop: `beforeFrame`, the
 *  draw, then the `onFrame` it was opened with (`interactive.ts`). */
export function dynamicWorld() {
  const { session } = sessionStandIn();
  const rewrites: VertexRange[][] = [],
    sources: ExplorerSource[] = [],
    opened: MeasuredWorldOptions[] = [],
    placed = { count: 0 };
  Object.assign(session, {
    updatePlacements: () => void placed.count++,
    updateVertices: (_: unknown, ranges: VertexRange[]) =>
      rewrites.push(ranges.map((r) => ({ ...r }))) > 0,
    setClearColor: () => true,
  });
  const open = (async (_: unknown, options: MeasuredWorldOptions, source: ExplorerSource) => (
    opened.push(options),
    sources.push(source),
    session
  )) as unknown as Open;
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open);
  const serve = URL.createObjectURL.bind(URL);
  const served = { count: 0 };
  URL.createObjectURL = (blob: Blob) => (served.count++, serve(blob));
  const frame = async () => (await runtime.settled(), runtime.render());
  const loop = async () => {
    await runtime.settled();
    runtime.beforeFrame();
    const metrics = session.render() as FrameMetrics;
    opened.at(-1)!.onFrame?.(metrics);
    return metrics;
  };
  const end = () => ((URL.createObjectURL = serve), runtime.dispose());
  return { scene, runtime, rewrites, sources, served, placed, frame, loop, end };
}
