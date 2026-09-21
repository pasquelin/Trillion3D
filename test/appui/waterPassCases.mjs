// What the water-pass proof renders and what it predicts from: shared by the page, which builds
// the scenes, and the test, which computes the expected centre of each from the same numbers.
/** The water material of every case: what the proof computes its expectations from. */
export const WATER = {
  tint: [0.85, 0.95, 1],
  ior: 1.33,
  attenuationDistance: 6,
  attenuationColor: [0.35, 0.72, 0.68],
};
/** The opaque ground behind the tile, and its distance from the tile along the optical axis. */
export const GROUND = { color: [0.72, 0.58, 0.4], depth: 2 };
/** Display background of the page: what a surface in front of nothing must let through. */
export const BACKGROUND = 0x336699;

/** The cases: a transmission, a thickness, and where the ground sits — behind the tile, or aside
 *  of it so that the scene keeps an opaque and the tile's centre sees nothing behind it. */
export const CASES = [
  { name: 'basin', transmission: 1, thickness: 2, groundX: 0 },
  { name: 'declared-deeper', transmission: 1, thickness: 10, groundX: 0 },
  { name: 'nothing-behind', transmission: 1, thickness: 2, groundX: 6 },
  { name: 'blend', transmission: 0, thickness: 2, groundX: 0 },
];
