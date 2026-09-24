// A transform does not draw. It marks the scene modified; the next render takes it.
// Before this batch, `setTransform` called `syncResident()` on each engine, and that engine
// rendered at once: ten poses set before a frame cost eleven GPU submits instead of one. This
// test's counter is that of a simulated device — `queue.submit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createExplorerLightApi } from '../api/lightApi.ts';
import { createFrameGateCore } from '../../frame/gateCore.ts';
import { hostWorldPlacements, type HostWorldPlacements } from '../../host/world/placements.ts';
import { setWebgpuTransform } from '../../webgpu/pages/render/transform.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';

/** A simulated engine that submits to the GPU as soon as a frame is asked of it. */
function engine() {
  let submissions = 0;
  const device = { queue: { submit: () => submissions++ } };
  const backend = {
    setTransform() {},
    syncResident() {
      device.queue.submit();
    },
    render() {
      device.queue.submit();
    },
  } as unknown as RenderBackend;
  return {
    backend,
    get submissions() {
      return submissions;
    },
  };
}

function api(backend: RenderBackend) {
  return createExplorerLightApi({
    check: () => {},
    store: undefined,
    imported: [],
    backends: [backend],
    active: () => backend,
  });
}

const pose = (x: number, y: number) =>
  new Float32Array(new G.Matrix4().makeTranslation(x, y, 0).elements);

test('ten transforms then one frame: one render submit, not eleven', () => {
  const m = engine();
  const explorer = api(m.backend);
  for (let i = 0; i < 10; i++) explorer.setTransform(`n${i}`, pose(i, 0));
  assert.equal(m.submissions, 0, 'no frame submitted during the poses');
  m.backend.render!(G.perspectiveCamera());
  assert.equal(m.submissions, 1, 'the host’s explicit render submits once, and only once');
});

test('an engine that cannot move a node refuses with a named error', () => {
  const explorer = api({} as RenderBackend);
  assert.throws(
    () => explorer.setTransform('n0', pose(0, 0)),
    /no engine of this session moves a named node/,
  );
});

/** The strict minimum `setWebgpuTransform` reads: a scene, a frame gate, a scheduler. */
function banc() {
  const source = new G.GraphNode();
  const node = new G.GraphNode();
  node.name = 'volet';
  source.add(node);
  const worlds = hostWorldPlacements(source);
  const gate = createFrameGateCore(1);
  const rows = { tableEpoch: 0 };
  const rt = {
    setup: { source, worlds },
    layout: { selectionRoots: [], rows },
    run: { gate, temporalHizState: {}, noOccluderHistory: false },
    lights: { plan: { worldChanged: () => {} } },
  } as unknown as WebgpuPagesRuntime;
  const camera = G.perspectiveCamera();
  const drawn = [{ sourceMesh: node }];
  /** One loop frame: the gate decides to hold, then stores what it just produced. */
  const frame = () => {
    const held = gate.enterFrame({}, camera, {}, undefined, source, drawn);
    gate.hold.keep(gate.revisions);
    return held;
  };
  return { rt, node, rows, frame, worlds };
}

/** What the frame would draw of this node: the world matrix THE ENGINE holds for it. */
const image = (b: { node: G.GraphNode; worlds: HostWorldPlacements }) =>
  Array.from(b.worlds.of(b.node).elements).join(',');

test('a pose changes the held frame: the gate refuses to serve the previous one again', () => {
  const b = banc();
  b.frame();
  b.frame();
  assert.equal(b.frame(), true, 'nothing has moved: the frame is held');
  const before = image(b);
  setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  assert.equal(b.frame(), false, 'the pose set, the held frame is refused');
  assert.notEqual(image(b), before, 'and the drawn node does carry the new pose');
});

test('the same pose set again invalidates nothing: the frame stays held', () => {
  const b = banc();
  setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  b.frame();
  b.frame();
  assert.equal(b.frame(), true, 'the frame is held');
  const epoque = b.rows.tableEpoch;
  for (let i = 0; i < 10; i++) setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  assert.equal(b.rows.tableEpoch, epoque, 'ten identical poses, no table rebuilt');
  assert.equal(b.frame(), true, 'and the held frame stays held');
});
