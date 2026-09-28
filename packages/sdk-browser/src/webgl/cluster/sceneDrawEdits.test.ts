// #984: the scene draw keeps its lists between images, and each image draws the graph as it
// stands — a mesh hidden, shown, added, removed or turned see-through between two frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { Scene } from '../../world/core/scene.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { GraphSurface } from '../../host/graph/surface.ts';

const OUTPUT = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

/** A mesh of `corners` indices — its count names it in the recorded draws. */
function mesh(corners: number, surface = new GraphSurface('standard')) {
  const geometry = new Geometry().setIndex(new BufferAttribute(new Uint32Array(corners), 1));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  return new Mesh(geometry, surface);
}

test('each image draws the graph as the edits since the last one left it', () => {
  const context = createTestContext(),
    scene = new Scene(),
    group = new Group(),
    glass = new GraphSurface('standard', { opacity: 0.5 });
  const [a, b, c] = [mesh(3), mesh(6, glass), mesh(9)];
  [a, b, c].forEach((node, rank) => (node.renderOrder = rank));
  group.add(b);
  scene.add(a, group);
  const draw = createSceneDraw(context.gl, scene);
  scene.background = scene.fog = null; // told to the link it now holds, which hears neither
  const frame = () => {
    const from = context.of('drawElements').length;
    draw.render({} as HostCamera);
    draw.host.drawHostGeometry(createHostDrawCamera(), OUTPUT);
    return context
      .of('drawElements')
      .slice(from)
      .map((args) => args[1]);
  };
  assert.deepEqual(frame(), [3, 6]);
  assert.deepEqual(frame(), [3, 6], 'nothing changed: the kept lists');
  group.visible = false;
  assert.deepEqual(frame(), [3], 'a group hidden');
  group.visible = true;
  scene.add(c);
  assert.deepEqual(frame(), [3, 6, 9], 'shown again, and a mesh added');
  glass.transparent = true;
  glass.needsUpdate = true;
  assert.deepEqual(frame(), [3, 9, 6], 'a surface turned see-through draws last');
  a.removeFromParent();
  assert.deepEqual(frame(), [9, 6], 'a mesh removed');
  draw.dispose();
  assert.equal(c._link, null, 'the graph gets its link back');
});
