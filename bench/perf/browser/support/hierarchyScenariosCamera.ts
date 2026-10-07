// Camera scenarios: `lookAt` and projections, edge cases included, replayed on both sides.
import { alea, dans } from './hierarchyScenarios.ts'
import type { CameraSpec, HierarchyOp, Pose, Quat, Vec3 } from './hierarchyScenarios.ts'

const HAUTS: Vec3[] = [
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [0, -1, 0],
]
const PARENTS: (Pose | null)[] = [
  null,
  [
    [4, -2, 7],
    [0.2, 0.5, -0.1, 0.84],
    [1, 1, 1],
  ],
  [
    [-3, 1, 2],
    [0, 0.6, 0, 0.8],
    [-1, 1, 1],
  ],
  [
    [0, 5, 0],
    [0.3, -0.2, 0.4, 0.84],
    [-2, -0.5, -3],
  ],
  [
    [1, 1, 1],
    [0.5, 0.5, 0.5, 0.5],
    [3, 0.25, 1],
  ],
  [
    [2, 0, -2],
    [0, 0, 0, 1],
    [0, 1, 1],
  ],
]
const fixedCamera: CameraSpec = {
  fov: 60,
  aspect: 16 / 9,
  near: 0.1,
  far: 1000,
  zoom: 1,
}
const origin: Pose = [
  [0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 1],
]

/**
 * `lookAt` of a camera and of an object, roots or children of a rotated parent, mirrored on one
 * or three axes, non-uniform or zero scale; ordinary targets, on the eye, NaN, infinite; up
 * collinear with the aim. After each aim: update, reads, camera frame.
 */
export function visees(): HierarchyOp[] {
  const ops: HierarchyOp[] = []
  let id = 0
  for (const parent of PARENTS) {
    const root = parent ? id++ : -1
    if (parent) ops.push(['add', root, -1, parent[0], parent[1], parent[2], null])
    const camera = id++,
      object = id++
    ops.push([
      'add',
      camera,
      root,
      [dans(10), dans(10), dans(10)],
      origin[1],
      origin[2],
      fixedCamera,
    ])
    ops.push(['add', object, root, [dans(10), dans(10), dans(10)], origin[1], origin[2], null])
    const onEye = id++
    ops.push(['add', onEye, root, origin[0], origin[1], origin[2], fixedCamera])
    const pointParent: Vec3 = parent ? parent[0] : [0, 0, 0]
    const cibles: Vec3[] = [
      [0, 0, 0],
      [dans(30), dans(30), dans(30)],
      pointParent,
      [NaN, 0, 0],
      [Infinity, 0, 0],
    ]
    for (const target of cibles)
      for (const top of HAUTS)
        for (const vise of [camera, object, onEye]) {
          ops.push(['vise', vise, target, top], ['maj', parent ? root : vise, false], ['lis', vise])
          if (vise !== object) ops.push(['image', vise])
        }
  }
  // Up collinear with the aim: above the origin with up `y`, in front of it with `±z`.
  const dessus = id,
    devant = id + 1
  ops.push(['add', dessus, -1, [0, 10, 0], origin[1], origin[2], fixedCamera])
  ops.push(['add', devant, -1, [0, 0, 10], origin[1], origin[2], fixedCamera])
  const suites: [number, Vec3][] = [
    [dessus, [0, 1, 0]],
    [dessus, [0, -1, 0]],
    [devant, [0, 0, 1]],
    [devant, [0, 0, -1]],
  ]
  for (const [vise, top] of suites)
    ops.push(['vise', vise, [0, 0, 0], top], ['maj', vise, false], ['lis', vise], ['image', vise])
  return ops
}

/**
 * Projections: ordinary and degenerate field, aspect, planes and magnification (zero or flat
 * field, zero `near`, `far` equal to `near` or infinite, zero zoom), each setting read in the
 * engine's one depth convention.
 */
export function objectifs(): HierarchyOp[] {
  const ops: HierarchyOp[] = [
    ['add', 0, -1, [1, 2, 3], [0.1, 0.2, 0.3, 0.927] as Quat, [1, 1, 1], fixedCamera],
  ]
  const image = (spec: CameraSpec) => ops.push(['objectif', 0, spec], ['image', 0])
  for (const fov of [1e-6, 45, 90, 179.999, 180, 0, NaN])
    for (const aspect of [1e-9, 1, 16 / 9, 1e9])
      for (const [near, far] of [
        [1e-6, 1e9],
        [0.1, 0.1],
        [0, 100],
        [0.5, Infinity],
        [10, 1],
      ])
        for (const zoom of [1, 2.5, 0]) image({ fov, aspect, near, far, zoom })
  for (let i = 0; i < 64; i++)
    image({
      fov: 10 + alea() * 160,
      aspect: 0.2 + alea() * 4,
      near: alea() * 2,
      far: 2 + alea() * 1e5,
      zoom: 0.1 + alea() * 4,
    })
  return ops
}
