import { bone, box, ellipsoid, merge, type Mesh } from './geometry.ts';

const MATERIAL_NAMES = [
  'bone',
  'shadow',
  'sandstone',
  'ochre',
  'markerRed',
  'markerBlue',
  'paper',
  'metal',
] as const;
type MaterialName = (typeof MATERIAL_NAMES)[number];
type Groups = Record<MaterialName, Mesh[]>;

const add = (groups: Groups, material: MaterialName, shape: Mesh) => groups[material].push(shape);
const curvedBone = (groups: Groups, points: number[][], radius: number) => {
  for (let index = 1; index < points.length; index++)
    add(groups, 'bone', bone(points[index - 1], points[index], radius));
};

function skeleton(groups: Groups) {
  add(groups, 'bone', ellipsoid([-4.25, 0.42, 0], [0.78, 0.5, 0.62], 18, 11));
  add(groups, 'bone', box([-4.55, 0.12, 0], [1.15, 0.22, 0.72]));
  for (const z of [-0.34, 0.34])
    add(groups, 'shadow', ellipsoid([-4.62, 0.5, z], [0.2, 0.16, 0.1]));
  for (let index = 0; index < 17; index++) {
    const x = -3.35 + index * 0.39,
      y = 0.45 + Math.sin(index * 0.32) * 0.08;
    add(groups, 'bone', ellipsoid([x, y, 0], [0.24, 0.22, 0.26], 12, 7));
    if (index < 13)
      for (const side of [-1, 1]) {
        const reach = 0.78 + Math.sin((index / 12) * Math.PI) * 0.72;
        curvedBone(
          groups,
          [
            [x, y, side * 0.16],
            [x, y - 0.12, side * 0.62],
            [x, y - 0.42, side * reach],
            [x, y - 0.73, side * (reach * 0.82)],
          ],
          0.07,
        );
      }
  }
  const tail = [
    [3.25, 0.42, 0],
    [4.15, 0.34, 0.08],
    [5.05, 0.23, 0.25],
    [5.9, 0.12, 0.5],
    [6.65, 0.03, 0.82],
    [7.25, -0.03, 1.12],
  ];
  for (let index = 1; index < tail.length; index++)
    add(groups, 'bone', bone(tail[index - 1], tail[index], 0.22 - index * 0.026, 12));
  for (const [x, direction] of [
    [-1.8, -1],
    [1.45, 1],
  ])
    for (const side of [-1, 1]) {
      const z = side * 0.42,
        knee = [x + direction * 0.38, -0.45, side * 1.08],
        ankle = [x + direction * 0.1, -1.12, side * 1.35];
      add(groups, 'bone', ellipsoid([x, 0.25, z], [0.34, 0.27, 0.28], 12, 8));
      add(groups, 'bone', bone([x, 0.18, z], knee, 0.13));
      add(groups, 'bone', bone(knee, ankle, 0.1));
      for (let toe = -1; toe <= 1; toe++)
        add(groups, 'bone', bone(ankle, [ankle[0] - 0.35, -1.15, ankle[2] + toe * 0.16], 0.045, 8));
    }
}

function excavation(groups: Groups) {
  add(groups, 'sandstone', box([0, -1.55, 0], [16, 0.48, 8.4]));
  for (let layer = 0; layer < 4; layer++) {
    const inset = layer * 0.42;
    for (const z of [-4.05 + inset, 4.05 - inset])
      add(
        groups,
        layer % 2 ? 'ochre' : 'sandstone',
        box([0, -1.24 + layer * 0.18, z], [16 - inset * 2, 0.2, 0.32]),
      );
    for (const x of [-7.8 + inset, 7.8 - inset])
      add(
        groups,
        layer % 2 ? 'ochre' : 'sandstone',
        box([x, -1.24 + layer * 0.18, 0], [0.32, 0.2, 8.1 - inset * 2]),
      );
  }
  for (const [x, z, color, number] of [
    [-5.4, -2.7, 'markerRed', 1],
    [0.2, 2.8, 'markerBlue', 2],
    [5.2, -2.6, 'markerRed', 3],
  ] as const) {
    add(groups, color, box([x, -0.65, z], [0.08, 1.05, 0.08]));
    add(groups, color, box([x, -0.15, z], [0.52, 0.38, 0.08]));
    for (let bar = 0; bar < number; bar++)
      add(groups, 'paper', box([x - 0.15 + bar * 0.15, -0.15, z - 0.05], [0.05, 0.2, 0.02]));
  }
  for (let rung = 0; rung < 7; rung++)
    add(groups, 'metal', box([6.55, -1.05 + rung * 0.24, -3.15], [1.2, 0.06, 0.08]));
  for (const x of [5.98, 7.12])
    add(groups, 'metal', bone([x, -1.2, -3.15], [x, 0.55, -3.15], 0.045, 8));
}

export function fossilExcavation(): Record<MaterialName, Mesh> {
  const groups = Object.fromEntries(MATERIAL_NAMES.map((name) => [name, [] as Mesh[]])) as Groups;
  skeleton(groups);
  excavation(groups);
  return Object.fromEntries(
    Object.entries(groups).map(([name, parts]) => [name, merge(parts)]),
  ) as Record<MaterialName, Mesh>;
}
