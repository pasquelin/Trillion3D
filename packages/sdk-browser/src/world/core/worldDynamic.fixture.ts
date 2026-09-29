import assert from 'node:assert/strict';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

/** A world on a session stand-in that takes every rewrite in place, and the page addresses the
 *  world serves while `counting`: one per page it cuts. */
export function dynamicWorld() {
  const { session } = sessionStandIn();
  const rewrites: VertexRange[][] = [],
    sources: ExplorerSource[] = [];
  Object.assign(session, {
    updateVertices: (_: unknown, ranges: VertexRange[]) => rewrites.push(ranges) > 0,
  });
  const open = (async (_canvas: unknown, _options: unknown, source: ExplorerSource) => (
    sources.push(source),
    session
  )) as unknown as Open;
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open);
  const serve = URL.createObjectURL.bind(URL);
  const served = { count: 0 };
  URL.createObjectURL = (blob: Blob) => (served.count++, serve(blob));
  const frame = async () => (await runtime.settled(), runtime.render());
  const end = () => ((URL.createObjectURL = serve), runtime.dispose());
  return { scene, runtime, rewrites, sources, served, frame, end };
}
