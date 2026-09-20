import { createWorkshop } from './geometry.mjs';

export const observatoryMaterials = [
  ['Warm limestone', [0.67, 0.48, 0.28, 1], 0, 0.82],
  ['Ivory carved stone', [0.86, 0.8, 0.62, 1], 0, 0.62],
  ['Patinated copper', [0.065, 0.36, 0.32, 1], 0.65, 0.38],
  ['Brushed brass', [0.75, 0.4, 0.085, 1], 0.75, 0.3],
  ['Midnight ceramic', [0.055, 0.095, 0.16, 1], 0.05, 0.5],
  ['Terracotta', [0.58, 0.16, 0.075, 1], 0, 0.76],
];

/** Solstice Court: an original, deterministic observatory, not a historical reconstruction. */
export function createObservatory() {
  const w = createWorkshop();
  w.block(0, [0, -0.45, 0], [25, 0.9, 20]);
  w.block(1, [0, 0.04, 0], [23.8, 0.08, 18.8]);
  // Individually raised paving stones cast fine contact shadows without texture assets.
  for (let z = -8; z <= 8; z += 2)
    for (let x = -10; x <= 10; x += 2)
      w.block((x + z) % 4 ? 0 : 1, [x, 0.11, z], [1.92, 0.08, 1.92]);
  for (let step = 0; step < 7; step++)
    w.block(0, [0, 0.12 + step * 0.13, 7.8 - step * 0.5], [7.4, 0.24 + step * 0.26, 0.5]);
  w.block(0, [0, 0.52, 0.1], [7.4, 1.04, 10.3]);
  w.block(4, [0, 1.06, 0], [6.8, 0.08, 7.3]);
  // Two open arcades leave long views through carved columns to the central instrument.
  for (const side of [-1, 1]) {
    const x = side * 8.3;
    for (const z of [-6, -2, 2, 6]) {
      w.block(0, [x, 0.37, z], [1.5, 0.52, 1.5]);
      w.turned(1, [x, 0.62, z], 0.46, 4.4, 16);
      w.block(1, [x, 5.1, z], [1.25, 0.28, 1.25]);
      w.turned(3, [x, 0.63, z], 0.52, 0.16, 0, 32);
    }
    for (const z of [-4, 0, 4]) {
      // The arch lies in the depth plane; its tapered voussoirs remain a curved LOD witness.
      w.patch(0, 64, 8, (u, v) => {
        const a = u * Math.PI,
          r = 2 + 0.32 * v;
        return [x - 0.48, 4.55 + r * Math.sin(a), z + r * Math.cos(a)];
      });
      w.patch(1, 64, 8, (u, v) => {
        const a = u * Math.PI,
          r = 2 + 0.32 * v;
        return [x + 0.48, 4.55 + r * Math.sin(a), z + r * Math.cos(a)];
      });
      w.patch(0, 64, 4, (u, v) => {
        const a = u * Math.PI;
        return [x - 0.48 + v * 0.96, 4.55 + 2 * Math.sin(a), z + 2 * Math.cos(a)];
      });
    }
    w.block(0, [x, 6.95, 0], [1.6, 0.36, 15]);
    w.block(2, [x, 7.2, 0], [1.85, 0.12, 15.3]);
  }
  // A domed asymmetrical lantern anchors the far side of the court.
  w.block(0, [-3, 2.5, -7], [7, 4.8, 4]);
  w.block(1, [-3, 5.02, -7], [7.4, 0.24, 4.4]);
  w.turned(1, [-3, 5.1, -7], 2.1, 1.1, 24);
  w.patch(2, 128, 32, (u, v) => {
    const a = u * Math.PI * 2,
      b = (v * Math.PI) / 2;
    const r = 2.35 * Math.cos(b) * (1 + 0.025 * Math.cos(24 * a));
    return [-3 + r * Math.cos(a), 6.2 + 2.7 * Math.sin(b), -7 - r * Math.sin(a)];
  });
  w.turned(3, [-3, 8.75, -7], 0.12, 0.9, 0, 32);
  // Deep door and stepped surround give the facade readable scale.
  w.block(4, [-3, 2.2, -4.96], [2.1, 3.5, 0.08]);
  for (const x of [-4.3, -1.7]) w.block(1, [x, 2.2, -4.85], [0.38, 3.8, 0.35]);
  w.block(1, [-3, 4.2, -4.82], [3.1, 0.35, 0.4]);
  // Brass armillary at the centre: oblique rings, engraved support and a ribbed core.
  w.turned(0, [0.6, 1.1, 0.2], 1, 0.9, 12);
  w.turned(1, [0.6, 2, 0.2], 0.55, 1.1, 18);
  for (const tilt of [0, 0.75, 1.5]) w.ring(3, [0.6, 4.1, 0.2], 2.1, 0.075, tilt);
  w.patch(2, 96, 48, (u, v) => {
    const a = u * Math.PI * 2,
      b = (1 - v) * Math.PI;
    const r = 0.83 + 0.045 * Math.sin(a * 18) * Math.sin(b * 10);
    return [
      0.6 + r * Math.sin(b) * Math.cos(a),
      4.1 + r * Math.cos(b),
      0.2 - r * Math.sin(b) * Math.sin(a),
    ];
  });
  // A low terracotta pavilion balances the domed tower without repeating its silhouette.
  w.block(5, [7.5, 1.2, -7.5], [4, 2.2, 3]);
  w.block(1, [7.5, 2.42, -7.5], [4.4, 0.25, 3.4]);
  for (let x = 6; x < 10; x += 0.55) w.block(0, [x, 2.8, -7.5], [0.27, 0.5, 3.2]);
  return w.surfaces;
}
