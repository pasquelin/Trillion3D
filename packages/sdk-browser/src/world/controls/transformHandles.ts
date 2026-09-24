import { box, cone, cylinder, plane } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { torus } from '../../../../sdk-core/src/world/geometry/round.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { markHelper } from '../helper/mark.ts';
import type { TransformHandle, TransformMode } from './transformMath.ts';

/** The axis colours of the `helper.axes` marks, and the plane handles' in the colour of the axis
 *  they face; the centre is white. */
const COLOURS = { x: 0xff0000, y: 0x00ff00, z: 0x0000ff, xyz: 0xffffff };
/** The turn that lays a part built along `+y` (arrows, shafts) or around `+z` (rings) on each
 *  axis, as Euler angles. */
const ALONG = { x: [0, 0, -Math.PI / 2], y: [0, 0, 0], z: [Math.PI / 2, 0, 0] } as const;
const AROUND = { x: [0, Math.PI / 2, 0], y: [Math.PI / 2, 0, 0], z: [0, 0, 0] } as const;
/** Proportions of the handles, in units of the gizmo's own size — its screen size is set by the
 *  control (`transform.ts`): a shaft's radius, a tip's length, a plane square's side. */
const SHAFT = 0.04,
  TIP = 0.2,
  SQUARE = 0.25;

/**
 * The handles of a transform control, unit size, one group per mode: arrows and plane squares to
 * move, rings to turn, shafts ending in cubes and a centre cube to scale. Every part is a mesh of
 * the `geometry` family in an unlit material, so the world draws it depth-tested like any object
 * and a pick hits it (`raycast`). Each axis owns ONE material, shared by all its parts: writing
 * its colour — the highlight of a dragged axis — repaints one entry in place (#335).
 */
export function buildTransformHandles() {
  const root = markHelper(new Group());
  const materials = {
    x: new Material('meshBasic', { color: COLOURS.x, side: 'double' }),
    y: new Material('meshBasic', { color: COLOURS.y, side: 'double' }),
    z: new Material('meshBasic', { color: COLOURS.z, side: 'double' }),
    xyz: new Material('meshBasic', { color: COLOURS.xyz, side: 'double' }),
  };
  const handles = new Map<Object3D, TransformHandle>();
  const groups = { translate: new Group(), rotate: new Group(), scale: new Group() };
  const part = (
    mode: TransformMode,
    handle: TransformHandle,
    shape: Geometry,
    colour: keyof typeof materials,
    at: readonly number[],
    turn: readonly number[] = [0, 0, 0],
  ) => {
    const mesh = new Mesh(shape, materials[colour]);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.rotation.set(turn[0], turn[1], turn[2]);
    handles.set(mesh, handle);
    groups[mode].add(mesh);
  };
  const along = (axis: 'x' | 'y' | 'z', distance: number) =>
    ['x', 'y', 'z'].map((c) => (c === axis ? distance : 0));
  for (const axis of ['x', 'y', 'z'] as const) {
    const shaft = cylinder(SHAFT, SHAFT, 1 - TIP, 8);
    part('translate', axis, shaft, axis, along(axis, (1 - TIP) / 2), ALONG[axis]);
    part('translate', axis, cone(TIP / 2, TIP, 12), axis, along(axis, 1 - TIP / 2), ALONG[axis]);
    part('scale', axis, shaft, axis, along(axis, (1 - TIP) / 2), ALONG[axis]);
    part('scale', axis, box(TIP, TIP, TIP), axis, along(axis, 1 - TIP / 2));
    part('rotate', axis, torus(1, SHAFT, 6, 48), axis, [0, 0, 0], AROUND[axis]);
    // The plane square facing this axis moves in the plane of the two others.
    const others = (['x', 'y', 'z'] as const).filter((c) => c !== axis);
    const centre = ['x', 'y', 'z'].map((c) => (c === axis ? 0 : SQUARE));
    const square = plane(SQUARE, SQUARE);
    part('translate', others.join('') as TransformHandle, square, axis, centre, AROUND[axis]);
  }
  part('scale', 'xyz', box(TIP * 1.5, TIP * 1.5, TIP * 1.5), 'xyz', [0, 0, 0]);
  for (const group of Object.values(groups)) root.add(group);
  return { root, groups, handles, materials, colours: COLOURS };
}
