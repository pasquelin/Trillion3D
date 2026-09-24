import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { camera, flushedGpuScene, quadScene } from './testScenes.fixture.ts';
import { prepared } from '../water/pass.fixture.ts';
import { uploadWorlds } from './render/worldUpload.ts';
import { orderBlendPasses } from '../blend/order.ts';
import { selectWebgpuBlend } from '../blend/selection.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { WebgpuPagesRuntime } from './runtime.ts';

// A node of a compiled model hidden once, then shown again, by the host (#407). Every frame
// renders and settles, the GPU cut drops the node's pages while it is hidden — its root parked
// as a parked row's is — and takes them back once it is shown.
test('the WebGPU path hides a compiled node the host hid, and draws it again once shown', async () => {
  installGpuGlobals();
  const scene = quadScene();
  const { backend } = await flushedGpuScene(scene);
  const run = backend as typeof backend & { selectedPageIds(): string[] };
  const node = scene.source.children[0];
  /** One frame, as the interactive loop runs it: drawn, then its pending work awaited. */
  const frame = async () => {
    run.render(camera());
    assert.equal(typeof (await run.pendingFrame!()), 'boolean', 'the frame settles');
    return run.selectedPageIds().sort();
  };
  try {
    for (let n = 0; n < 3; n++) assert.deepEqual(await frame(), ['0', '1']);
    node.visible = false;
    await frame(); // the park voids the cut in hand: the next readback is cut without the node
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), [], 'hidden, none of its pages is drawn');
      assert.equal(run.metrics().submittedTriangles, 0);
    }
    node.visible = true;
    await frame();
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), ['0', '1'], 'shown again, it is drawn again');
      assert.equal(run.metrics().submittedTriangles, 2);
    }
  } finally {
    run.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
});

// The same node's see-through parts and shadow: a hidden node vanishes entirely (#407).
test('a host hide parks the root, hides its blend items and stales the shadow pages it covered', () => {
  const { blendState } = prepared();
  const group = new G.GraphGroup(),
    node = new G.GraphGroup(),
    other = new G.GraphGroup();
  group.add(node);
  const [item, kept] = blendState.blendGpu;
  item.sourceMesh = node as never;
  kept.sourceMesh = other as never;
  const root = {
    pages: [{ sourceMesh: node }],
    worldBox: new Float64Array([-1, -2, -3, 1, 2, 3]),
  } as unknown as ClusterRoot<PageRec>;
  const parks: [number, boolean][] = [],
    changed: number[][] = [];
  const rt = {
    run: {
      gate: { updateWorlds: () => true, revisions: { scene: 1 } },
      gpuSelection: { parkWorld: (rank: number, parked: boolean) => parks.push([rank, parked]) },
      worldUploadRevision: 1,
      worldUploadOrigin: new Float64Array(3),
    },
    setup: { worlds: {} },
    layout: { selectionRoots: [root], worldUpdates: [], rows: { tableEpoch: 0 } },
    timing: { worldCounts: {} },
    blendState,
    lights: {
      plan: { worldChanged: (lo: number[], hi: number[]) => changed.push([...lo, ...hi]) },
    },
  } as unknown as WebgpuPagesRuntime;
  const cam = { eye: new Float64Array(3) } as unknown as EngineCamera;
  group.visible = false;
  uploadWorlds(rt, cam);
  assert.deepEqual(parks, [[0, true]]);
  assert.equal(item.hidden, true, 'the blend item of the hidden node is hidden');
  assert.ok(!kept.hidden, 'another node keeps its blend item');
  assert.deepEqual(changed, [[-1, -2, -3, 1, 2, 3]], 'its shadow pages are drawn again');
  orderBlendPasses(blendState, [0, 0, 0]);
  assert.equal(blendState.keepPacked[0] & 1, 0, 'the GPU path keeps it out');
  selectWebgpuBlend(blendState);
  assert.ok(!blendState.visibleBlend.includes(item), 'the fallback path leaves it out');
  uploadWorlds(rt, cam);
  assert.equal(changed.length, 1, 'a revision that changes nothing stales nothing');
  group.visible = true;
  uploadWorlds(rt, cam);
  assert.deepEqual(parks, [
    [0, true],
    [0, false],
  ]);
  assert.equal(item.hidden, false);
  assert.equal(changed.length, 2, 'shown again, its shadow is drawn again');
  orderBlendPasses(blendState, [0, 0, 0]);
  assert.equal(blendState.keepPacked[0] & 1, 1);
  selectWebgpuBlend(blendState);
  assert.ok(blendState.visibleBlend.includes(item));
});
