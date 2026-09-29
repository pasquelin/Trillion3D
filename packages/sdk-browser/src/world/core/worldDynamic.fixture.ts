import assert from 'node:assert/strict';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

/** A world on a session stand-in that takes every rewrite in place; `served` counts its pages. */
export function dynamicWorld() {
  const { session } = sessionStandIn();
  const rewrites: VertexRange[][] = [],
    sources: ExplorerSource[] = [];
  Object.assign(session, {
    updateVertices: (_: unknown, ranges: VertexRange[]) =>
      rewrites.push(ranges.map((r) => ({ ...r }))) > 0,
    setClearColor: () => true,
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
