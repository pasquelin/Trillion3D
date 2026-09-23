import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/index.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { cone } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { ColorInput } from '../../../../sdk-core/src/world/math/color.ts';
import type { Plane } from '../../../../sdk-core/src/world/math/volumes.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';

/** Line segments through `points` (two corners per segment), in one colour. */
function lines(points: number[], color: ColorInput) {
  const geometry = new Geometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  return new Mesh(geometry, new Material('line', { color }), 'lineSegments');
}

/** The segments of a circle of `radius` in the plane `(u, v)`, in `sides` steps. */
function circle(radius: number, sides: number, plane: 'xy' | 'xz' = 'xz') {
  const out: number[] = [];
  for (let i = 0; i < sides; i++)
    for (const k of [i, i + 1]) {
      const a = (k / sides) * Math.PI * 2;
      const [x, y] = [Math.cos(a) * radius, Math.sin(a) * radius];
      out.push(...(plane === 'xz' ? [x, 0, y] : [x, y, 0]));
    }
  return out;
}

/** The four sides of the square of half-width `h` in the `xy` plane. */
// prettier-ignore
const square = (h: number) =>
  [-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0];

/** The twelve edges of the box `[min, max]`. */
function boxEdges(min: Vector3, max: Vector3) {
  const c = (i: number) => [i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z];
  const pairs = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  return pairs.flatMap(c);
}

/** A group of marks that follows `target`'s pose when the page calls `update()`. */
function following(target: Object3D, marks: Object3D[]) {
  const group = Object.assign(new Group(), {
    update() {
      target.updateWorldMatrix(true, false);
      target.matrixWorld.decompose(group.position, group.quaternion, group.scale);
    },
  });
  group.add(...marks);
  group.update();
  return group;
}

/** The `helper` family: the marks a scene is worked on with, built from lines and meshes. */
export const helper = {
  axes(size = 1) {
    const group = new Group();
    group.add(lines([0, 0, 0, size, 0, 0], 0xff0000), lines([0, 0, 0, 0, size, 0], 0x00ff00));
    group.add(lines([0, 0, 0, 0, 0, size], 0x0000ff));
    return group;
  },
  grid(size = 10, divisions = 10, centre: ColorInput = 0x444444, rest: ColorInput = 0x888888) {
    const half = size / 2,
      step = size / divisions;
    const main: number[] = [],
      other: number[] = [];
    for (let i = 0; i <= divisions; i++) {
      const at = -half + i * step,
        into = Math.abs(at) < step / 2 ? main : other;
      into.push(-half, 0, at, half, 0, at, at, 0, -half, at, 0, half);
    }
    const group = new Group();
    group.add(lines(main, centre), lines(other, rest));
    return group;
  },
  polarGrid(radius = 10, sectors = 16, rings = 8, color: ColorInput = 0x888888) {
    const out: number[] = [];
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      out.push(0, 0, 0, Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    for (let r = 1; r <= rings; r++) out.push(...circle((radius * r) / rings, 64));
    return lines(out, color);
  },
  box(target: Object3D, color: ColorInput = 0xffff00) {
    const box = new Box3().setFromObject(target);
    return lines(boxEdges(box.min, box.max), color);
  },
  plane(p: Plane, size = 1, color: ColorInput = 0xffff00) {
    const outline = lines(square(size / 2), color);
    outline.quaternion.setFromUnitVectors({ x: 0, y: 0, z: 1 }, p.normal);
    outline.position.copy(p.normal.clone().multiplyScalar(-p.constant));
    return outline;
  },
  arrow(dir: Vector3, origin = new Vector3(), length = 1, color: ColorInput = 0xffff00) {
    const head = Math.min(length * 0.2, length),
      shaft = lines([0, 0, 0, 0, length - head, 0], color);
    const tip = new Mesh(cone(head * 0.5, head, 12), new Material('meshBasic', { color }));
    tip.position.set(0, length - head / 2, 0);
    const group = new Group();
    group.add(shaft, tip);
    group.position.copy(origin);
    group.quaternion.copy(
      new Quaternion().setFromUnitVectors({ x: 0, y: 1, z: 0 }, dir.clone().normalize()),
    );
    return group;
  },
  camera(c: Camera) {
    const t = Math.tan((c.fov * Math.PI) / 360);
    const corners = [c.near, c.far].flatMap((d) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => [x * d * t * c.aspect, y * d * t, -d]),
    );
    const out: number[] = [];
    for (let i = 0; i < 4; i++)
      for (const [a, b] of [
        [i, (i + 1) % 4],
        [i + 4, ((i + 1) % 4) + 4],
        [i, i + 4],
      ])
        out.push(...corners[a], ...corners[b]);
    return following(c, [lines(out, 0xffaa00)]);
  },
  directionalLight(l: Light, size = 1) {
    return following(l, [lines([...square(size / 2), 0, 0, 0, 0, 0, -size * 2], l.color)]);
  },
  pointLight(l: Light, size = 1) {
    return following(l, [lines([...circle(size, 32, 'xz'), ...circle(size, 32, 'xy')], l.color)]);
  },
  spotLight(l: Light) {
    const length = l.distance || 1,
      r = Math.tan(l.angle) * length;
    const rim = circle(r, 32, 'xy').map((v, i) => (i % 3 === 2 ? -length : v));
    const out = [...rim];
    for (const [x, y] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ])
      out.push(0, 0, 0, x, y, -length);
    return following(l, [lines(out, l.color)]);
  },
  hemisphereLight(l: Light, size = 1) {
    return following(l, [
      lines(circle(size, 32, 'xz'), l.color),
      lines(circle(size, 32, 'xy'), l.groundColor),
    ]);
  },
};
