import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

export const hasConditionalLine = (geometry: Geometry) =>
  !!geometry.attributes._ldraw_control0 && !!geometry.attributes._ldraw_control1;

/** LDraw optional edges show when both control points project to the same side. */
export function updateConditionalLines(meshes: Iterable<Mesh>, camera: Camera) {
  camera.updateWorldMatrix(true, false);
  const view = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const transform = new Matrix4();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    transform.multiplyMatrices(view, mesh.matrixWorld);
    const attributes = mesh.geometry.attributes;
    const project = (name: string, vertex: number) => {
      const attribute = attributes[name];
      const x = attribute.getComponent(vertex, 0),
        y = attribute.getComponent(vertex, 1),
        z = attribute.getComponent(vertex, 2);
      const m = transform.elements;
      return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[3] * x + m[7] * y + m[11] * z + m[15],
      ];
    };
    const a = project('position', 0),
      b = project('position', 1);
    const c = project('_ldraw_control0', 0),
      d = project('_ldraw_control1', 0);
    const side = (p: number[]) =>
      a[0] * (b[1] * p[2] - b[2] * p[1]) -
      a[1] * (b[0] * p[2] - b[2] * p[0]) +
      a[2] * (b[0] * p[1] - b[1] * p[0]);
    const first = side(c),
      second = side(d);
    const shown =
      Number.isFinite(first) && Number.isFinite(second) && first * second * c[2] * d[2] >= 0;
    if (mesh.visible !== shown) mesh.visible = shown;
  }
}
