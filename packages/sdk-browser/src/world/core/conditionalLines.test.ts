import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { carriedLine } from './modelLines.ts';
import { updateConditionalLines } from './conditionalLines.ts';

test('optional edges follow camera projection while an explicit user hide stays hidden', () => {
  const attribute = (values: number[]) => new BufferAttribute(new Float32Array(values), 3);
  const shape = geometry.createBuffer({
    position: attribute([-1, 0, 0, 1, 0, 0]),
  });
  shape.setAttribute('_ldraw_control0', attribute([0, 1, 1, 0, 1, 1]));
  shape.setAttribute('_ldraw_control1', attribute([0, 1, -1, 0, 1, -1]));
  const parent = carriedLine(new Mesh(shape, new GraphSurface('basic'), 'lineSegments'))!;
  const edge = parent.children[0] as Mesh;
  for (const projection of ['perspective', 'orthographic'] as const) {
    const camera = new Camera(projection);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    updateConditionalLines([edge], camera);
    assert.equal(edge.visible, true);
    camera.position.set(0, 5, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    updateConditionalLines([edge], camera);
    assert.equal(edge.visible, false);
    parent.visible = false;
    camera.position.set(0, 0, 5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    updateConditionalLines([edge], camera);
    assert.equal(edge.visible, true);
    assert.equal(parent.visible, false);
  }
});
