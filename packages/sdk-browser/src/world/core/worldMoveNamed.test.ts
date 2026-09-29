// #972: a move by name through the session API reaches a world built in code. Its engines hold the
// page's scene as rows — one host mesh per resource (`worldMirror.ts`) — so a name resolves on the
// page's own scene, by the name index, and the pose is written as a page write is: the rows every
// engine reads, WebGPU and WebGL2 alike. A hierarchy moved by name, frame after frame, leaves the
// rows bit-identical to the same poses the page writes itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { createExplorerLightApi } from '../api/lightApi.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';
import { seeded } from '../../host/world/randomTree.fixture.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

const NAMES = ['body', 'arm', 'hand'];

/** A robot-like world: body > arm > hand, a box on each, opened on a session stand-in; its move
 *  by name taken through the public session API. */
async function robot() {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { session } = sessionStandIn();
  let source: ExplorerSource | undefined;
  const open = (async (_canvas: unknown, _options: unknown, opened: ExplorerSource) => {
    source = opened;
    return session;
  }) as unknown as Open;
  const failures: unknown[] = [];
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => failures.push(error), open);
  const nodes = NAMES.map((name) => Object.assign(object.group(), { name }));
  nodes.forEach((node, i) => {
    node.add(object.mesh(geometry.box(1, 1 + i, 1)));
    (i ? nodes[i - 1] : scene).add(node);
  });
  await runtime.settled();
  runtime.render();
  assert.deepEqual(failures, []);
  const api = createExplorerLightApi({
    check: () => {},
    store: undefined,
    imported: [],
    backends: [],
    active: () => ({}) as RenderBackend,
    moveNamed: source!.moveNamed,
  });
  const rows = () =>
    [...source!.scene.associations.values()].flatMap((link) =>
      link.placements ? [(link.placements as PlacementRows).matrices] : [],
    );
  return { scene, runtime, nodes, api, rows };
}

/** A local pose whose products are exact: dyadic steps, power-of-two scales, half-turns. */
function exactPose(draw: () => number) {
  const step = () => (Math.floor(draw() * 129) - 64) / 8,
    scale = () => 2 ** (Math.floor(draw() * 4) - 1),
    turns = [new Quaternion(), new Quaternion(1, 0, 0, 0), new Quaternion(0, 1, 0, 0)];
  return {
    position: new Vector3(step(), step(), draw() < 0.2 ? -0 : step()),
    quaternion: turns[Math.floor(draw() * turns.length)],
    scale: new Vector3(scale(), scale(), scale()),
  };
}

/** The world `node` stands at once its local pose is `pose`. */
function worldOf(node: Object3D, pose: ReturnType<typeof exactPose>) {
  const local = new Matrix4().compose(pose.position, pose.quaternion, pose.scale);
  node.parent!.updateWorldMatrix(true, false);
  return new Float32Array(new Matrix4().multiplyMatrices(node.parent!.matrixWorld, local).elements);
}

test('a hierarchy moved by name through the session API: the rows of the page’s own writes', async () => {
  const [moved, written] = [await robot(), await robot()];
  const draw = seeded(972);
  for (let frame = 0; frame < 60; frame++) {
    for (let k = 0; k < 1 + Math.floor(draw() * 3); k++) {
      const at = Math.floor(draw() * NAMES.length),
        pose = exactPose(draw);
      const node = written.nodes[at];
      moved.api.setTransform(NAMES[at], worldOf(moved.nodes[at], pose));
      node.position.copy(pose.position);
      node.quaternion.copy(pose.quaternion);
      node.scale.copy(pose.scale);
    }
    moved.runtime.render();
    written.runtime.render();
    const [a, b] = [moved.rows(), written.rows()];
    assert.equal(a.length, NAMES.length);
    a.forEach((rows, i) =>
      assert.deepEqual(Float32Array.from(rows), Float32Array.from(b[i]), `frame ${frame}`),
    );
  }
  for (const { runtime } of [moved, written]) runtime.dispose();
});

test('a name the page does not bear, or a pose of other than sixteen floats, is refused', async () => {
  const { api, runtime, rows } = await robot();
  const before = rows().map((r) => r.slice());
  const pose = new Float32Array(new Matrix4().elements);
  const code = (move: () => void) => {
    try {
      move();
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };
  assert.equal(
    code(() => api.setTransform('leg', pose)),
    'UNKNOWN_SCENE_NODE',
  );
  assert.equal(
    code(() => api.setTransform('arm', pose.subarray(1))),
    'INVALID_TRANSFORM',
  );
  assert.equal(
    code(() =>
      api.setTransform(
        'arm',
        pose.map(() => NaN),
      ),
    ),
    'NON_FINITE_TRANSFORM',
  );
  runtime.render();
  assert.deepEqual(rows(), before, 'nothing moved');
  runtime.dispose();
});
