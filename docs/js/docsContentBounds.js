/** Boxes, spheres, frustums and cones: what decides, per frame, whether a cluster is drawn. */
const B = { section: 'bounds', kind: 'Function', module: 'packages/sdk-core/mathBox.ts' };
const F = { section: 'bounds', kind: 'Function', module: 'packages/sdk-core/mathFrustum.ts' };

export const BOUNDS = [
  {
    ...B,
    id: 'boxUnion',
    exports: ['BOX_VALUES', 'boxEmpty', 'boxIsEmpty', 'boxExpandByPoint', 'boxUnion'],
    title: 'boxEmpty() · boxIsEmpty() · boxExpandByPoint() · boxUnion()',
    signature:
      'BOX_VALUES = 6\nboxEmpty(out, o)\nboxIsEmpty(box, o)\nboxExpandByPoint(out, o, x, y, z)\nboxUnion(out, o, minX, minY, minZ, maxX, maxY, maxZ)',
    description:
      'A box is six numbers stored flat from `o`: three lower bounds, three upper. An empty box has its lower bounds at `+Infinity` and its upper at `-Infinity`; a NaN bound does not make a box empty. Expanding and uniting take the bounds as parameters, so no temporary object is built per call.',
    replaces: 'Box3.makeEmpty, isEmpty, expandByPoint, union',
  },
  {
    ...B,
    id: 'boxTransform',
    exports: ['boxTransform', 'boxCornersInto'],
    title: 'boxTransform() · boxCornersInto()',
    signature:
      'boxTransform(out, o, box, bo, m)\nboxCornersInto(out, o, minX, minY, minZ, maxX, maxY, maxZ, m)',
    description:
      'The box enclosing the image of `box` by `m`: the union of its eight transformed corners. An empty box stays as is, bounds included, and `out` may be `box` — bounds are read before the first write. `boxCornersInto` writes those eight corners flat, twenty-four numbers: corner `i` takes the upper bound on `x` when bit 1 is set, on `y` for bit 2, on `z` for bit 4, each corner being the homogeneous transform `(m·p) / (m₃·p)`.',
    replaces: 'Box3.applyMatrix4',
  },
  {
    ...B,
    id: 'sphereFromBounds',
    exports: ['sphereFromBounds'],
    title: 'sphereFromBounds()',
    module: 'packages/sdk-core/mathSphere.ts',
    signature: 'sphereFromBounds(out, o, minX, minY, minZ, maxX, maxY, maxZ)',
    description:
      'The bounding sphere of a box, written flat from `o`: centre `x, y, z` then radius. The centre is `(min + max) * 0.5`, the radius half the diagonal. An empty box — an upper bound below its lower — yields the empty sphere, zero centre and radius `-1`. This is the reference box arithmetic term by term, NaN, signed zeros and infinities included.',
    replaces: 'Box3.getBoundingSphere',
  },
  {
    ...F,
    id: 'frustumPlanesFromMatrix',
    exports: ['FRUSTUM_PLANE_VALUES', 'frustumPlanesFromMatrix', 'clipPlanesFromMatrix'],
    title: 'frustumPlanesFromMatrix() · clipPlanesFromMatrix()',
    signature:
      'FRUSTUM_PLANE_VALUES = 24\nfrustumPlanesFromMatrix(out, m)\nclipPlanesFromMatrix(out, m)',
    description:
      'The six planes of the frustum of a clip matrix — a view-projection, or a projection alone for planes in view space. The first normalises them, so `a·x + b·y + c·z + d` is a signed distance; the second leaves the raw sums and differences of the rows, where the sign alone decides, with no square root or division: the form of the exact clip test, where normalising would shift the rounding. A degenerate matrix yields NaN or infinite planes without throwing.',
    replaces: 'Frustum.setFromProjectionMatrix',
    proof: 'bench Frustum.setFromProjectionMatrix (×1.6 on the side planes)',
  },
  {
    ...F,
    id: 'frustumFarPlane',
    exports: ['frustumFarPlane', 'frustumPlanesToLocal'],
    title: 'frustumFarPlane() · frustumPlanesToLocal()',
    signature:
      'frustumFarPlane(out, at, view, far, normalize)\nfrustumPlanesToLocal(out, planes, m)',
    description:
      'The far plane of a frustum whose projection has none. The engine projection is infinite: its depth row no longer bounds anything, so the far plane is read from the **view** matrix, whose third row gives the view depth — a point is inside when `far + z >= 0`. A non-finite `far` leaves the zero plane in place, a truly unbounded far plane. `frustumPlanesToLocal` carries the planes into the local space of a transform, so a local box is tested without being transformed.',
  },
  {
    ...F,
    id: 'frustumExcludesBox',
    exports: ['frustumExcludesBox', 'frustumClipBox'],
    title: 'frustumExcludesBox() · frustumClipBox()',
    module: 'packages/sdk-core/mathFrustumBox.ts',
    signature:
      'frustumExcludesBox(planes, minX, minY, minZ, maxX, maxY, maxZ): boolean\nfrustumClipBox(planes, minX, minY, minZ, maxX, maxY, maxZ): 0 | 1 | 2',
    description:
      'The box against the frustum: the first is true when a plane leaves all eight corners behind. The second returns three states — 0 outside, 1 straddling, 2 entirely inside — in two passes, the first only rejecting, the second reading the most trailing corner to tell "straddling" from "inside". A subtree entirely inside saves a test on every box underneath it.',
    replaces: 'Frustum.intersectsBox',
  },
  {
    ...F,
    id: 'boxConeRejects',
    exports: ['boxConeRejects', 'CONE_LENGTH_RATIO', 'CONE_ORTHO_EPS', 'HALF_PI'],
    title: 'boxConeRejects()',
    module: 'packages/sdk-core/mathCone.ts',
    signature:
      'boxConeRejects(axis, angle, min, max, world, normal, scale, eyeX, eyeY, eyeZ)\nCONE_LENGTH_RATIO = 1.0001 · CONE_ORTHO_EPS = 1e-4 · HALF_PI',
    description:
      "Rejection of a local box by its normal cone, seen from a world point: the box is replaced by its sphere, the cone axis carried by the normal matrix and normalised, the verdict taken on the clamped dot product, the cone angle and the sphere's perspective spread. A transform is conformal when its columns have the same length within `CONE_LENGTH_RATIO` and are orthogonal within `CONE_ORTHO_EPS`; a cone of angle ≥ `HALF_PI` never rejects, and a parameter the test refuses does not reject either. The `_WGSL` variants are the same constants as the shader text, so the CPU mirror and the GPU pass cannot drift.",
  },
];
