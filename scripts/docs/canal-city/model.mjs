import { box, combine, mesh, triangle } from '../../../site/lessons/offline/mesh.ts';
const groups = () => ({
  brick: [],
  ochre: [],
  stone: [],
  slate: [],
  glass: [],
  water: [],
  metal: [],
});
const add = (out, material, center, size) => out[material].push(box(center, size));

function roofPrism(center, size) {
  const [cx, cy, cz] = center,
    [sx, sy, sz] = size,
    x0 = cx - sx / 2,
    x1 = cx + sx / 2,
    y0 = cy - sy / 2,
    y1 = cy + sy / 2,
    z0 = cz - sz / 2,
    z1 = cz + sz / 2,
    out = mesh(),
    p = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [cx, y1, z0],
      [cx, y1, z1],
    ];
  for (const [a, b, c] of [
    [0, 1, 4],
    [2, 5, 3],
    [0, 4, 5],
    [0, 5, 2],
    [1, 3, 5],
    [1, 5, 4],
    [0, 2, 3],
    [0, 3, 1],
  ])
    triangle(out, p[a], p[b], p[c]);
  return out;
}

function canalWindow(out, side, facade, y, z) {
  add(out, 'glass', [facade - side * 0.035, y, z], [0.08, 0.42, 0.34]);
  add(out, 'stone', [facade - side * 0.09, y + 0.27, z], [0.2, 0.08, 0.46]);
}
function endWindow(out, x, y, facadeZ, direction) {
  add(out, 'glass', [x, y, facadeZ + direction * 0.035], [0.36, 0.42, 0.08]);
  add(out, 'stone', [x, y + 0.27, facadeZ + direction * 0.09], [0.48, 0.08, 0.2]);
}

function canalBuilding(out, { side, z, width, depth, floors, material, roof }) {
  const facade = side * 2.35,
    height = floors * 0.72 + 0.55,
    centerX = facade + side * depth * 0.5;
  add(out, material, [centerX, height / 2, z], [depth, height, width]);
  add(out, 'stone', [facade - side * 0.07, 0.28, z], [0.16, 0.56, width + 0.08]);
  add(out, 'glass', [facade - side * 0.04, 0.48, z], [0.09, 0.72, 0.62]);
  add(out, 'metal', [facade - side * 0.1, 0.42, z + width * 0.32], [0.16, 0.84, 0.48]);
  const outerFacade = facade + side * depth;
  for (let floor = 0; floor < floors; floor++) {
    const y = 0.72 + floor * 0.72,
      bays = Math.max(2, Math.floor(width / 0.72));
    for (let bay = 0; bay < bays; bay++)
      canalWindow(out, side, facade, y, z + ((bay + 0.5) / bays - 0.5) * (width - 0.3));
    for (let bay = 0; bay < bays; bay++)
      canalWindow(out, -side, outerFacade, y, z + ((bay + 0.5) / bays - 0.5) * (width - 0.3));
    for (const direction of [-1, 1])
      for (const x of [centerX - depth * 0.25, centerX + depth * 0.25])
        endWindow(out, x, y, z + (direction * width) / 2, direction);
    add(out, 'stone', [facade - side * 0.1, y - 0.31, z], [0.2, 0.08, width + 0.12]);
  }
  add(out, 'stone', [facade - side * 0.14, height + 0.04, z], [0.28, 0.16, width + 0.2]);
  add(out, 'stone', [outerFacade + side * 0.14, height + 0.04, z], [0.28, 0.16, width + 0.2]);
  for (const direction of [-1, 1])
    add(
      out,
      'stone',
      [centerX, height + 0.04, z + direction * (width / 2 + 0.1)],
      [depth + 0.12, 0.16, 0.2],
    );
  if (roof === 'setback') {
    add(
      out,
      material,
      [centerX + side * 0.18, height + 0.58, z],
      [depth - 0.36, 1.16, width - 0.55],
    );
    canalWindow(out, side, facade + side * 0.36, height + 0.58, z);
    for (const direction of [-1, 1])
      endWindow(
        out,
        centerX + side * 0.18,
        height + 0.58,
        z + (direction * (width - 0.55)) / 2,
        direction,
      );
    add(
      out,
      'slate',
      [centerX + side * 0.18, height + 1.22, z],
      [depth - 0.24, 0.14, width - 0.43],
    );
  } else if (roof === 'gable')
    out.slate.push(roofPrism([centerX, height + 0.42, z], [depth + 0.1, 0.84, width + 0.08]));
  else add(out, 'slate', [centerX, height + 0.12, z], [depth + 0.14, 0.24, width + 0.14]);
}

function warehouse(out, side, z, width) {
  const facade = side * 2.35,
    centerX = facade + side * 0.8;
  add(out, 'brick', [centerX, 0.85, z], [1.6, 1.7, width]);
  out.slate.push(roofPrism([centerX, 2.1, z], [1.7, 0.8, width + 0.1]));
  for (const offset of [-0.5, 0, 0.5])
    add(out, 'glass', [facade - side * 0.04, 0.95, z + offset], [0.09, 0.78, 0.42]);
  for (const offset of [-0.5, 0, 0.5])
    canalWindow(out, -side, facade + side * 1.6, 0.95, z + offset);
  add(out, 'metal', [facade - side * 0.1, 0.42, z], [0.16, 0.84, 0.72]);
  for (const direction of [-1, 1])
    for (const x of [centerX - 0.42, centerX + 0.42])
      endWindow(out, x, 0.95, z + (direction * width) / 2, direction);
}

export function canalCity() {
  const out = groups();
  add(out, 'water', [0, -0.18, 0], [3.45, 0.12, 9]);
  for (const x of [-1.1, -0.45, 0.35, 1.05])
    add(out, 'water', [x, -0.105 + Math.abs(x) * 0.006, 0.3], [0.035, 0.018, 7.8]);
  for (const side of [-1, 1]) {
    add(out, 'stone', [side * 2.02, 0, 0], [0.58, 0.22, 9]);
    add(out, 'stone', [side * 1.74, -0.08, 0], [0.12, 0.36, 9]);
    for (let z = -3.9; z <= 3.9; z += 1.3)
      add(out, 'metal', [side * 1.78, 0.34, z], [0.08, 0.7, 0.08]);
    for (let step = 0; step < 3; step++)
      add(
        out,
        'stone',
        [side * (1.82 - step * 0.13), -0.04 - step * 0.08, 1.55],
        [0.28, 0.1, 0.9 - step * 0.12],
      );
  }
  add(out, 'stone', [0, 0.28, -0.65], [4.15, 0.34, 0.95]);
  for (const side of [-1, 1]) add(out, 'metal', [side * 1.72, 0.62, -0.65], [0.08, 0.68, 0.95]);
  for (const edge of [-1.05, -0.25]) {
    add(out, 'metal', [0, 0.68, edge], [3.45, 0.08, 0.08]);
    for (const x of [-1.15, -0.58, 0, 0.58, 1.15])
      add(out, 'metal', [x, 0.43, edge], [0.07, 0.54, 0.07]);
  }
  for (const side of [-1, 1]) add(out, 'stone', [side * 1.58, 0.12, -0.65], [0.22, 0.58, 1.08]);
  const buildings = [
    [-1, -2.95, 1.75, 1.55, 4, 'brick', 'setback'],
    [-1, -0.05, 1.9, 1.7, 3, 'ochre', 'gable'],
    [-1, 2.9, 1.85, 1.55, 4, 'brick', 'flat'],
    [1, -3, 1.8, 1.65, 3, 'ochre', 'gable'],
    [1, 0.05, 1.85, 1.55, 4, 'brick', 'setback'],
    [1, 3, 1.75, 1.7, 3, 'ochre', 'flat'],
  ];
  for (const [side, z, width, depth, floors, material, roof] of buildings)
    canalBuilding(out, { side, z, width, depth, floors, material, roof });
  warehouse(out, -1, 4.15, 1.15);
  warehouse(out, 1, 4.1, 1.2);
  return Object.fromEntries(Object.entries(out).map(([key, parts]) => [key, combine(parts)]));
}
