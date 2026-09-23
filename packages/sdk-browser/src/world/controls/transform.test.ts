import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { createOrbitCameraControls } from '../../camera/controls/orbitControls.ts';
import { fixtureDrag, fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { createTransformControls } from './transform.ts';

/** A 400 px square canvas seen by a 50° camera ten units in front of `at`, an orbit on it. */
function rig(at: { x: number; y: number; z: number }) {
  const surface = fixtureSurface(400);
  const camera = new Camera('perspective', { fov: 50 });
  camera.position.set(at.x, at.y, at.z + 10);
  const orbit = createOrbitCameraControls(camera, surface.element);
  orbit.target.set(at.x, at.y, at.z);
  const scene = new Group();
  const canvas = surface.element as HTMLCanvasElement;
  const host = { canvas, scene, camera, onFrame: () => () => {} };
  return { surface, camera, orbit, scene, gizmo: createTransformControls(host) };
}
/** World units per canvas pixel on the plane ten units ahead. */
const unit = (2 * 10 * Math.tan((25 * Math.PI) / 180)) / 400;

test('dragging an arrow moves the object and keeps the orbit still; beside it, the orbit turns', () => {
  const { surface, camera, scene, gizmo } = rig({ x: 0, y: 0, z: 0 });
  const box = object.mesh(geometry.box(1, 1, 1));
  scene.add(box);
  const events: string[] = [];
  for (const type of ['dragStart', 'change', 'dragEnd'] as const)
    gizmo.addEventListener(type, () => events.push(type));
  gizmo.attach(box);
  assert.equal(gizmo.handles.parent, scene, 'the handles are in the scene while attached');
  // The x arrow's shaft crosses the canvas at 243 px: one world unit right of the centre.
  fixtureDrag(surface, 40, 0, { clientX: 243, clientY: 200 });
  assert.ok(Math.abs(box.position.x - 40 * unit) < 1e-9, 'the box followed the pointer');
  assert.deepEqual(camera.position.toArray(), [0, 0, 10], 'the orbit never heard the press');
  assert.deepEqual(events, ['dragStart', 'change', 'dragEnd']);
  gizmo.snap.translate = 0.5;
  fixtureDrag(surface, 30, 0, { clientX: 243 + 40, clientY: 200 });
  assert.ok(Math.abs(box.position.x - 40 * unit - 0.5) < 1e-9, 'snapped to half a unit');
  fixtureDrag(surface, 40, 0, { clientX: 100, clientY: 100 });
  assert.notDeepEqual(camera.position.toArray(), [0, 0, 10], 'a press beside turns the camera');
  gizmo.dispose();
  assert.equal(box.children.length + scene.children.length, 1, 'the handles left the scene');
});

test('a child under a moved, turned and scaled parent moves in the world as the handle shows', () => {
  const { surface, scene, gizmo } = rig({ x: 5, y: 0, z: 0 });
  const parent = new Object3D(),
    child = object.mesh(geometry.box(1, 1, 1));
  parent.position.set(5, 0, 0);
  parent.rotation.y = Math.PI / 2;
  parent.scale.set(2, 2, 2);
  parent.add(child);
  scene.add(parent);
  gizmo.attach(child);
  fixtureDrag(surface, 40, 0, { clientX: 243, clientY: 200 });
  const at = child.getWorldPosition(new Vector3());
  assert.ok(
    Math.abs(at.x - 5 - 40 * unit) < 1e-9 && Math.abs(at.y) < 1e-9 && Math.abs(at.z) < 1e-9,
  );
});

test('attaching another object during a drag ends the drag: dragEnd, and the old object rests', () => {
  const { surface, scene, gizmo } = rig({ x: 0, y: 0, z: 0 });
  const first = object.mesh(geometry.box(1, 1, 1)),
    second = object.mesh(geometry.box(1, 1, 1));
  scene.add(first, second);
  const events: string[] = [];
  gizmo.addEventListener('dragEnd', () => events.push('dragEnd'));
  gizmo.attach(first);
  const press = { pointerId: 1, button: 0, clientX: 243, clientY: 200 };
  surface.fire('pointerdown', press);
  assert.equal(gizmo.dragging, true);
  gizmo.attach(second);
  assert.deepEqual(events, ['dragEnd']);
  assert.equal(gizmo.dragging, false);
  surface.fire('pointermove', { ...press, clientX: 283 });
  assert.deepEqual([first.position.x, second.position.x], [0, 0], 'no drag carried over');
});
