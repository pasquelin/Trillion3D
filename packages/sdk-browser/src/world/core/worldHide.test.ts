// A node of a compiled world hidden once, 60 frames after load, then shown again (#407), through
// the real bricks: the world runtime on a compiled cache of the repository, the frame scheduler,
// and the WebGPU pages backend — its GPU cut included — on the mock device. The node is found by
// name through the public API, as the report's probe did (its `TypeError` there was the "stall").
// The camera moves through the hide and the show, as the report's did: every frame drawn must
// settle, the loop must go idle on its own, and the node must leave the draw list and return to
// exactly the pages it had. Each frame awaits the engine's own drain (`pendingFrame`), never a
// count of event-loop turns: a drain that never settles is a hung test, which the runner's bound
// names; nothing waits on it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { findGraphNode } from './modelNodes.ts';
import {
  HOST,
  readsInFlight,
  runtimeOf,
  sessionStandIn,
  type Open,
} from './worldRuntime.fixture.ts';
import { webgpuPagesBackend } from '../../webgpu/pages/pages.ts';
import { createExplorerPageSources } from '../session/pageSources.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import { createExplorerFrameScheduler } from '../render/frameScheduler.ts';
import { frameQueue } from '../render/frameQueue.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

const MODEL = `${HOST}assets/examples/a-model-from-obj/cache/native/full/manifest.json`;
const NODE = 'white-queen-d1';
/** The pages backend, with the drawn page list its tests read. */
type Paged = ReturnType<typeof webgpuPagesBackend> & { selectedPageIds(): string[] };

/** True when `node` is `ancestor` or sits under it. */
const under = (node: Object3D | null | undefined, ancestor: Object3D) => {
  for (let walk = node; walk; walk = walk.parent) if (walk === ancestor) return true;
  return false;
};

/**
 * The session a world opens, drawn by the WebGPU pages backend on the mock device: the cache's
 * pages streamed from disk, its DAG packed for the mock's cut kernel. `nodeUrls` collects the
 * page addresses of the graph node named `node`.
 */
function openOnMockGpu(camera: ReturnType<typeof G.perspectiveCamera>, node: string) {
  const opened = {
    backend: undefined as Paged | undefined,
    nodeUrls: new Set<string>(),
    invalidate: () => {},
  };
  const open = (async (_canvas: unknown, _options: unknown, source: ExplorerSource) => {
    const { metadata, base, scene } = source;
    const channel = createDiagnosticChannel(undefined);
    const pages = await createExplorerPageSources(
      metadata,
      { manifestUrl: source.manifestUrl },
      base,
      undefined,
      false,
      [],
      channel,
      () => {},
    );
    const { roots } = collectClusterPages(scene.source, metadata, new Map(), scene.associations, {
      allowMissing: true,
    });
    const graph = findGraphNode(scene.source, node)!;
    for (const root of roots)
      if (under(root.pages[0]?.sourceMesh, graph))
        for (const page of root.pages) opened.nodeUrls.add(page.url);
    const limits = { maxBufferSize: 1 << 28, maxStorageBufferBindingSize: 1 << 28 };
    const gpu = mockGpu({ limits, packed: packDagSelection(roots) });
    const backend = webgpuPagesBackend({
      source: scene.source,
      metadata,
      indices: new Map(),
      readPage: (url) => pages.streamer.read(url),
      readGeometryPage: (url) => pages.streamer.readBytes(url),
      associations: scene.associations,
      textureIndices: scene.textureIndices,
      gpuDevice: gpu.device,
      viewport: [64, 64],
      pixelError: 1,
    });
    await backend.prepare();
    opened.backend = backend as Paged;
    const { session } = sessionStandIn();
    return {
      ...session,
      invalidate: () => opened.invalidate(),
      // A session renders and returns its metrics, which the runtime completes (#573).
      render: () => (backend.render(camera), {}),
      dispose: () => backend.dispose(),
    };
  }) as unknown as Open;
  return { open, opened };
}

const HIDDEN_AND_SHOWN =
  'a compiled node hidden 60 frames after load: every frame settles, it leaves and returns';
/** Names a drain that never settles, far above the test's own time; nothing waits on it. */
const HUNG = { timeout: 60_000 };

test(HIDDEN_AND_SHOWN, HUNG, async () => {
  installGpuGlobals();
  const camera = G.perspectiveCamera(50, 1, 0.1, 100);
  const { open, opened } = openOnMockGpu(camera, NODE);
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const failures: unknown[] = [];
  const runtime = runtimeOf(scene, ready, (error) => failures.push(error), open);
  const model = await scene.load(MODEL);
  await runtime.settled();
  const backend = opened.backend!;
  // The loop as `startInteractiveExplorer` wires it; the page's animation frames are a queue.
  const requested = frameQueue();
  /** The drain the loop waits on for the frame just drawn: the engine's own completion. */
  let draining: Promise<boolean> | undefined;
  /** Frames drawn: a frame the loop asks for but holds draws nothing, which `drawOne` names. */
  let drawnFrames = 0;
  const scheduler = createExplorerFrameScheduler({
    request: requested.request,
    cancel: requested.cancel,
    render: () => (drawnFrames++, void runtime.render()),
    pending: () => (draining = backend.pendingFrame!()),
    error: (error) => failures.push(error),
    limited: () => failures.push('the loop hit its frame limit'),
  });
  opened.invalidate = scheduler.invalidate;
  /** Draws the frame the loop asks for next and waits for the engine's drain of it. The loop
   *  hears the drain first — it asked for it — so the frame it wants next is queued after. */
  const drawOne = async () => {
    const drawn = drawnFrames;
    assert.ok(requested.run(), 'the loop asked for a frame');
    assert.equal(drawnFrames, drawn + 1, 'the frame asked for was drawn');
    const drain = draining;
    draining = undefined;
    await drain?.catch(() => {});
  };
  /** Draws what the loop asks until it asks none, each drain awaited, so idle means every frame
   *  drawn completed. Nothing may still be read: a read the loop no longer waits on is work the
   *  image never gets. */
  const untilIdle = async () => {
    while (requested.size > 0) await drawOne();
    assert.deepEqual(failures, []);
    assert.equal(readsInFlight(), 0, 'the loop went idle with a page still read from disk');
    return backend.selectedPageIds();
  };
  const nodePages = (ids: string[]) => ids.filter((id) => opened.nodeUrls.has(id)).sort();
  const look = (x: number) => {
    camera.position.set(x, 1, 1.2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    scheduler.invalidate();
  };
  /** `frames` frames with the camera moving each one, then the view of reference, settled. */
  const moveThenSettle = async (frames: number) => {
    for (let frame = 1; frame <= frames; frame++) {
      look(frame * 1e-3);
      await drawOne();
    }
    look(0);
    return untilIdle();
  };
  try {
    assert.ok(opened.nodeUrls.size > 0, `${NODE} has pages of its own`);
    const before = nodePages(await moveThenSettle(60));
    assert.ok(before.length > 0, 'the node is drawn before it is hidden');
    const node = model.getObjectByName(NODE);
    assert.ok(node, 'the public API finds the compiled node by name');
    node.visible = false;
    const hidden = await moveThenSettle(30);
    assert.ok(hidden.length > 0, 'the rest of the world is still drawn');
    assert.deepEqual(nodePages(hidden), [], 'hidden, none of its pages is drawn');
    node.visible = true;
    const shown = nodePages(await moveThenSettle(30));
    assert.deepEqual(shown, before, 'shown again, it draws the pages it drew before the hide');
  } finally {
    scheduler.dispose();
    runtime.dispose();
  }
});
