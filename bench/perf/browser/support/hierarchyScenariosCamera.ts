// Camera scenarios of batch M3a: `lookAt` and projections, edge cases included, replayed on both sides.
import { alea, dans } from './hierarchyScenarios.ts';
import type { CameraSpec, HierarchyOp, Pose, Quat, Vec3 } from './hierarchyScenarios.ts';

const HAUTS: Vec3[] = [
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [0, -1, 0],
];
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
];
const cameraFixe: CameraSpec = {
  fov: 60,
  aspect: 16 / 9,
  near: 0.1,
  far: 1000,
  zoom: 1,
  webgpu: false,
};
const origine: Pose = [
  [0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 1],
];

/**
 * `lookAt` of a camera and of an object, roots or children of a rotated parent, mirrored on one
 * or three axes, non-uniform or zero scale; ordinary targets, on the eye, NaN, infinite; up
 * collinear with the aim. After each aim: update, reads, camera frame.
 */
export function visees(): HierarchyOp[] {
  const ops: HierarchyOp[] = [];
  let id = 0;
  for (const parent of PARENTS) {
    const racine = parent ? id++ : -1;
    if (parent) ops.push(['ajoute', racine, -1, parent[0], parent[1], parent[2], null]);
    const camera = id++,
      objet = id++;
    ops.push([
      'ajoute',
      camera,
      racine,
      [dans(10), dans(10), dans(10)],
      origine[1],
      origine[2],
      cameraFixe,
    ]);
    ops.push([
      'ajoute',
      objet,
      racine,
      [dans(10), dans(10), dans(10)],
      origine[1],
      origine[2],
      null,
    ]);
    const surOeil = id++;
    ops.push([
      'ajoute',
      surOeil,
      racine,
      origine[0],
      origine[1],
      origine[2],
      { ...cameraFixe, webgpu: true },
    ]);
    const pointParent: Vec3 = parent ? parent[0] : [0, 0, 0];
    const cibles: Vec3[] = [
      [0, 0, 0],
      [dans(30), dans(30), dans(30)],
      pointParent,
      [NaN, 0, 0],
      [Infinity, 0, 0],
    ];
    for (const cible of cibles)
      for (const haut of HAUTS)
        for (const vise of [camera, objet, surOeil]) {
          ops.push(
            ['vise', vise, cible, haut],
            ['maj', parent ? racine : vise, false],
            ['lis', vise],
          );
          if (vise !== objet) ops.push(['image', vise, vise === surOeil]);
        }
  }
  // Up collinear with the aim: above the origin with up `y`, in front of it with `±z`.
  const dessus = id,
    devant = id + 1;
  ops.push(['ajoute', dessus, -1, [0, 10, 0], origine[1], origine[2], cameraFixe]);
  ops.push(['ajoute', devant, -1, [0, 0, 10], origine[1], origine[2], cameraFixe]);
  const suites: [number, Vec3][] = [
    [dessus, [0, 1, 0]],
    [dessus, [0, -1, 0]],
    [devant, [0, 0, 1]],
    [devant, [0, 0, -1]],
  ];
  for (const [vise, haut] of suites)
    ops.push(
      ['vise', vise, [0, 0, 0], haut],
      ['maj', vise, false],
      ['lis', vise],
      ['image', vise, true],
    );
  return ops;
}

/**
 * Projections: ordinary and degenerate field, aspect, planes and magnification (zero or flat
 * field, zero `near`, `far` equal to `near` or infinite, zero zoom), each setting in both
 * depth conventions, planes read in both conventions.
 */
export function objectifs(): HierarchyOp[] {
  const ops: HierarchyOp[] = [
    ['ajoute', 0, -1, [1, 2, 3], [0.1, 0.2, 0.3, 0.927] as Quat, [1, 1, 1], cameraFixe],
  ];
  const image = (spec: CameraSpec) =>
    ops.push(['objectif', 0, spec], ['image', 0, false], ['image', 0, true]);
  for (const webgpu of [false, true])
    for (const fov of [1e-6, 45, 90, 179.999, 180, 0, NaN])
      for (const aspect of [1e-9, 1, 16 / 9, 1e9])
        for (const [near, far] of [
          [1e-6, 1e9],
          [0.1, 0.1],
          [0, 100],
          [0.5, Infinity],
          [10, 1],
        ])
          for (const zoom of [1, 2.5, 0]) image({ fov, aspect, near, far, zoom, webgpu });
  for (let i = 0; i < 64; i++)
    image({
      fov: 10 + alea() * 160,
      aspect: 0.2 + alea() * 4,
      near: alea() * 2,
      far: 2 + alea() * 1e5,
      zoom: 0.1 + alea() * 4,
      webgpu: alea() < 0.5,
    });
  return ops;
}
