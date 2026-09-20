import { theatreWorkshop } from './geometry.mjs';

export const theatreMaterials = [
  ['Ivory projection wall', [0.9, 0.78, 0.58, 1], 0, 0.74],
  ['Burgundy velvet', [0.34, 0.018, 0.035, 1], 0, 0.9],
  ['Aged brass', [0.58, 0.28, 0.055, 1], 0.82, 0.24],
  ['Walnut stage', [0.15, 0.045, 0.018, 1], 0.05, 0.58],
  ['Cut paper silhouettes', [0.015, 0.02, 0.028, 1], 0, 0.82],
  ['Moon enamel', [0.06, 0.16, 0.3, 1], 0.42, 0.22],
];

/** An original miniature theatre arranged to make cast silhouettes unmistakable. */
export function createShadowTheatre() {
  const { surfaces, patch, box, lathe, ribbon, disc, oval, triangle } = theatreWorkshop();
  box(0, [0, 4.2, -3.5], [12, 8.4, 0.25]);
  box(3, [0, -0.35, -0.3], [14.5, 0.7, 9]);
  box(3, [0, 7.9, -0.3], [14.5, 0.45, 1]);
  for (const side of [-1, 1]) {
    box(3, [side * 6.8, 3.7, -0.3], [0.65, 8, 1.2]);
    lathe(
      2,
      [side * 6.8, -0.05, 0],
      [
        [0, 0.62],
        [0.25, 0.82],
        [0.5, 0.55],
        [6.9, 0.48],
        [7.15, 0.78],
        [7.45, 0.62],
      ],
    );
    ribbon(1, [side * 5.75, 4.1, -0.1], 2.05, 7.5, 0.35, 4, side * 0.13);
  }
  ribbon(1, [0, 7.15, -0.15], 10.4, 1.5, 0.4, 7, 0.2);
  for (const side of [-1, 1])
    for (let y = 0; y < 5; y++)
      disc(2, [side * 6.8, 1.1 + y * 1.3, 0.68], 0.22 + (y % 2) * 0.08, 32);
  const z = -1.45;
  // A bird with swept wings.
  oval(4, [-2.8, 4, z], 0.36, 0.27);
  oval(4, [-2.38, 4.14, z], 0.24, 0.22);
  patch(4, 24, 5, (u, v) => {
    const x = (u - 0.5) * 2.5,
      wing = Math.sin(u * Math.PI);
    return [-2.8 + x, 4.05 + Math.abs(x) * 0.34 + (v - 0.5) * wing * 0.72, z];
  });
  triangle(4, [-2.2, 4.18, z], [-1.82, 4.12, z], [-2.2, 4.02, z]);
  // A fox in profile with pointed ears and a raised tail.
  oval(4, [-0.05, 3.95, z], 0.85, 0.42);
  oval(4, [0.72, 4.28, z], 0.38, 0.34);
  triangle(4, [0.46, 4.48, z], [0.52, 4.98, z], [0.75, 4.56, z]);
  triangle(4, [0.72, 4.55, z], [0.9, 4.96, z], [1, 4.42, z]);
  triangle(4, [0.98, 4.34, z], [1.35, 4.22, z], [0.96, 4.12, z]);
  triangle(4, [-0.76, 4.14, z], [-1.65, 4.9, z], [-0.9, 3.7, z]);
  box(4, [-0.48, 3.38, z], [0.13, 0.9, 0.08]);
  box(4, [0.35, 3.4, z], [0.13, 0.85, 0.08]);
  // A leafy branch, built from a fork and five distinct leaves.
  box(4, [2.7, 4, z], [0.16, 2.7, 0.08]);
  for (const [x, y, rx, ry] of [
    [2.15, 3.7, 0.62, 0.24],
    [3.25, 4.05, 0.58, 0.23],
    [2.2, 4.55, 0.55, 0.22],
    [3.15, 4.9, 0.62, 0.24],
    [2.7, 5.3, 0.32, 0.52],
  ])
    oval(4, [x, y, z], rx, ry);
  for (const x of [-2.8, 0, 2.7]) box(2, [x, 6.75, z], [0.025, 4.1, 0.025]);
  disc(5, [0, 5.25, -3.34], 1.25, 64);
  disc(0, [0.48, 5.62, -3.28], 1.15, 64);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    disc(2, [Math.cos(angle) * 4.7, 4.1 + Math.sin(angle) * 2.7, -3.28], 0.1, 16);
  }
  return surfaces;
}
