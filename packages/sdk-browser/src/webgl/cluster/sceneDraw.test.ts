import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphGroup, GraphInstancedMesh, GraphMesh } from '../../host/graph/mesh.ts';
import { GraphCamera } from '../../host/graph/camera.ts';
import { readHostDrawCamera } from '../../camera/world.ts';
import { GraphGeometry } from '../../host/graph/geometry.ts';
import { GraphAttribute } from '../../host/graph/attributes.ts';
import { GraphSurface } from '../../host/graph/surface.ts';

const OUTPUT = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

/** A mesh of `corners` indices — its count names it in the recorded draws. */
function mesh(corners: number, renderOrder: number, surface = new GraphSurface('standard')) {
  const geometry = new GraphGeometry().setIndex(new GraphAttribute(new Uint32Array(corners), 1));
  geometry.setAttribute('position', new GraphAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new GraphAttribute(new Float32Array(9), 3));
  const made = new GraphMesh(geometry, surface);
  made.renderOrder = renderOrder;
  made.frustumCulled = false;
  return made;
}

function drawn(scene: GraphScene) {
  const context = createTestContext();
  const draw = createSceneDraw(context.gl, scene);
  assert.equal(draw.counters(), null, 'no count before the first frame');
  assert.throws(() => draw.drawHostGeometry(createHostDrawCamera(), OUTPUT), /Draw before render/);
  draw.render({} as HostCamera);
  draw.drawHostGeometry(createHostDrawCamera(), OUTPUT);
  return { context, draw };
}

test('the opaque meshes draw by order, the see-through ones after, a hidden one never', () => {
  const scene = new GraphScene();
  const glass = mesh(9, 0, new GraphSurface('standard', { transparent: true, opacity: 0.5 }));
  const hidden = mesh(12, 0);
  hidden.visible = false;
  scene.add(mesh(3, 1), glass, mesh(6, 0), hidden);
  const { context, draw } = drawn(scene);
  assert.deepEqual(
    context.of('drawElements').map((args) => args[1]),
    [6, 3, 9],
  );
  assert.deepEqual(draw.counters(), { triangles: 6 });
  draw.dispose();
});

test('an instanced mesh is one submission of every placement it counts', () => {
  const scene = new GraphScene();
  const source = mesh(6, 0);
  const placed = new GraphInstancedMesh(source.geometry, source.material as GraphSurface, 4);
  placed.count = 3;
  scene.add(placed);
  const { context, draw } = drawn(scene);
  assert.deepEqual(
    context.of('drawElementsInstanced').map((args) => [args[1], args[4]]),
    [[6, 3]],
  );
  assert.deepEqual(draw.counters(), { triangles: 6 });
  assert.equal(context.of('vertexAttribDivisor').length, 4, 'one divisor per matrix column');
  draw.dispose();
});

test('without a context the draw is refused by name', () => {
  const draw = createSceneDraw(undefined, new GraphScene());
  draw.render({} as HostCamera);
  assert.throws(
    () => draw.drawHostGeometry(createHostDrawCamera(), OUTPUT),
    /HOST_SURFACE_MISSING/,
  );
});

// Issue #275: a mesh under a moved parent draws at its WORLD placement, as the reference draws it
// — never at its own local matrix.
test('a mesh under a translated and rotated group draws where the reference draws it', async () => {
  const three = await import('three');
  const pose = (
    node: {
      position: { set(x: number, y: number, z: number): unknown };
      rotation: { set(x: number, y: number, z: number): unknown };
    },
    p: number[],
    r: number[],
  ) => {
    node.position.set(p[0], p[1], p[2]);
    node.rotation.set(r[0], r[1], r[2]);
  };
  const scene = new GraphScene(),
    group = new GraphGroup(),
    child = mesh(3, 0),
    witness = new three.Group(),
    witnessChild = new three.Mesh();
  pose(group, [4, -1, -6], [0.3, 0.9, 0]);
  pose(witness, [4, -1, -6], [0.3, 0.9, 0]);
  pose(child, [1, 2, -3], [0, 0, 0.4]);
  pose(witnessChild, [1, 2, -3], [0, 0, 0.4]);
  group.add(child);
  scene.add(group);
  witness.add(witnessChild);
  witness.updateMatrixWorld();
  const context = createTestContext(),
    draw = createSceneDraw(context.gl, scene),
    camera = new GraphCamera({ fov: 60, aspect: 1, near: 0.1, far: 100 });
  draw.render({} as HostCamera);
  draw.drawHostGeometry(readHostDrawCamera(createHostDrawCamera(), camera), OUTPUT);
  const uploaded = context
    .of('uniformMatrix4fv')
    .find((args) => (args[0] as { uniform: string }).uniform === 'modelViewMatrix')!;
  const expected = new Float32Array(witnessChild.matrixWorld.elements);
  assert.deepEqual(Array.from(uploaded[2] as Float32Array), Array.from(expected));
  draw.dispose();
});
