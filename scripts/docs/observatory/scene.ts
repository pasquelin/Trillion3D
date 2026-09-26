import { bottom, createWorkshop, top, type Part } from './geometry.ts';

/** Name, glTF base color RGBA, metallic factor, roughness factor. */
export const observatoryMaterials: [string, [number, number, number, number], number, number][] = [
  ['Warm limestone', [0.67, 0.48, 0.28, 1], 0, 0.82],
  ['Ivory carved stone', [0.86, 0.8, 0.62, 1], 0, 0.62],
  ['Patinated copper', [0.065, 0.36, 0.32, 1], 0.65, 0.38],
  ['Brushed brass', [0.75, 0.4, 0.085, 1], 0.75, 0.3],
  ['Midnight ceramic', [0.055, 0.095, 0.16, 1], 0.05, 0.5],
  ['Terracotta', [0.58, 0.16, 0.075, 1], 0, 0.76],
];

const limestone = observatoryMaterials.find(([name]) => name === 'Warm limestone');
if (!limestone) throw new Error('the observatory names no Warm limestone');
const [, [red, green, blue]] = limestone;
/** The court's sky, which a scene file cannot carry (it declares only its sun): a clear sky at a
 *  fifth of the sun's intensity, the clear-day ratio of sky to sun, tinted from below by the
 *  court's limestone (its linear source colour). Written beside the source for every reader. */
export const observatorySky = {
  color: '#a6c6ff',
  groundColor: [red, green, blue] as const,
  sunShare: 1 / 5,
};

/** The paving stones' pitch and size, in metres, and how many stones run out from the centre
 *  along x and z; they lie on the court's slab, and the rest of the court stands on them. */
export const paving = { pitch: 2, size: [1.92, 0.08, 1.92], stones: [5, 4] };

/** Solstice Court: an original, deterministic observatory, not a historical reconstruction.
 *  Every part stands on the one under it: its height is read from that part's top. */
export function createObservatory() {
  const w = createWorkshop();
  const ground = w.block(0, [0, -0.9, 0], [25, 0.9, 20]);
  const slabTop = top(w.block(1, [0, top(ground), 0], [23.8, 0.08, 18.8]));
  // Individually raised paving stones cast fine contact shadows without texture assets.
  const stones: Part[] = [];
  for (let j = -paving.stones[1]; j <= paving.stones[1]; j++)
    for (let i = -paving.stones[0]; i <= paving.stones[0]; i++)
      stones.push(
        w.block((i + j) % 2 ? 0 : 1, [i * paving.pitch, slabTop, j * paving.pitch], paving.size),
      );
  const pavingTop = top(stones[0]),
    far = -(paving.stones[1] * paving.pitch + paving.size[2] / 2);
  // A domed asymmetrical lantern anchors the far side of the court, its back on the far edge.
  const lantern = [7, 4.8, 4],
    lanternZ = far + lantern[2] / 2,
    front = far + lantern[2];
  const body = w.block(0, [-3, pavingTop, lanternZ], lantern);
  const cornice = w.block(1, [-3, top(body), lanternZ], [7.4, 0.24, 4.4]);
  const drum = w.turned(1, [-3, top(cornice), lanternZ], 2.1, 1.1, 24);
  const dome = w.patch(2, 128, 32, (u, v) => {
    const a = u * Math.PI * 2,
      b = (v * Math.PI) / 2;
    const r = 2.35 * Math.cos(b) * (1 + 0.025 * Math.cos(24 * a));
    return [-3 + r * Math.cos(a), top(drum) + 2.7 * Math.sin(b), lanternZ - r * Math.sin(a)];
  });
  w.turned(3, [-3, top(dome), lanternZ], 0.12, 0.9, 0, 32);
  // Deep door and stepped surround give the facade readable scale: the jambs stand on the
  // paving against the facade, the door fills the opening and the lintel spans the jambs.
  const jamb = [0.38, 3.8, 0.35],
    door = [2.1, jamb[1], 0.08],
    lintel = [3.1, 0.35, 0.4];
  const jambs = [-4.3, -1.7].map((x) => w.block(1, [x, pavingTop, front + jamb[2] / 2], jamb));
  w.block(4, [-3, pavingTop, front + door[2] / 2], door);
  w.block(1, [-3, top(jambs[0]), front + lintel[2] / 2], lintel);
  // The instrument's platform runs from the door's surround to its steps, whose foot it sets;
  // seven steps climb it from the paving in equal risers, the platform's top the last.
  const platformFront = 5.25,
    platform = [7.4, 1.04, platformFront - front - jamb[2]];
  const deck = w.block(0, [0, pavingTop, platformFront - platform[2] / 2], platform);
  for (let step = 0, steps = 7; step < steps; step++) {
    const size = [platform[0], (platform[1] * (steps - step)) / (steps + 1), 0.5];
    w.block(0, [0, pavingTop, platformFront + size[2] * (step + 0.5)], size);
  }
  const pool = w.block(4, [0, top(deck), 0], [6.8, 0.08, 7.3]);
  // Brass armillary at the centre: oblique rings, engraved support and a ribbed core. The upright
  // ring runs down through the stem to its foot, and the core hangs at the rings' centre.
  const support = w.turned(0, [0.6, top(pool), 0.2], 1, 0.9, 12);
  const stem = w.turned(1, [0.6, top(support), 0.2], 0.55, 1.1, 18);
  const ringRadius = 2.1,
    center = [0.6, bottom(stem) + ringRadius, 0.2];
  for (const tilt of [0, 0.75, 1.5]) w.ring(3, center, ringRadius, 0.075, tilt);
  w.patch(2, 96, 48, (u, v) => {
    const a = u * Math.PI * 2,
      b = (1 - v) * Math.PI;
    const r = 0.83 + 0.045 * Math.sin(a * 18) * Math.sin(b * 10);
    return [
      center[0] + r * Math.sin(b) * Math.cos(a),
      center[1] + r * Math.cos(b),
      center[2] - r * Math.sin(b) * Math.sin(a),
    ];
  });
  // Two open arcades leave long views through carved columns to the central instrument; each
  // column's plinth rests on the fourth paving stone out, centred on it, the shaft on the plinth,
  // the capital on the shaft, the arches on the capitals and the entablature on their crowns.
  const plinth = [1.5, 0.52, 1.5],
    capital = [1.25, 0.28, 1.25],
    [radius, thickness, depth] = [2, 0.32, 0.96],
    columns = [-3, -1, 1, 3].map((stone) => stone * paving.pitch);
  for (const side of [-1, 1]) {
    const x = side * 4 * paving.pitch;
    const capitals = columns.map((z) => {
      const foot = w.block(0, [x, pavingTop, z], plinth);
      const shaft = w.turned(1, [x, top(foot), z], 0.46, 4.4, 16);
      w.turned(3, [x, top(foot), z], 0.52, 0.16, 0, 32);
      return w.block(1, [x, top(shaft), z], capital);
    });
    // Every capital tops the same column: the arches spring from their common height.
    const spring = top(capitals[0]);
    const arch = (a: number, r: number) => [spring + r * Math.sin(a), r * Math.cos(a)];
    for (const z of [-2, 0, 2].map((stone) => stone * paving.pitch)) {
      // The arch lies in the depth plane, `depth` thick across x; its tapered voussoirs remain a
      // curved LOD witness.
      for (const [material, face] of [
        [0, -1],
        [1, 1],
      ])
        w.patch(material, 64, 8, (u, v) => {
          const [y, dz] = arch(u * Math.PI, radius + thickness * v);
          return [x + (face * depth) / 2, y, z + dz];
        });
      w.patch(0, 64, 4, (u, v) => {
        const [y, dz] = arch(u * Math.PI, radius);
        return [x - depth / 2 + v * depth, y, z + dz];
      });
    }
    const beam = w.block(0, [x, spring + radius + thickness, 0], [1.6, 0.36, 15]);
    w.block(2, [x, top(beam), 0], [1.85, 0.12, 15.3]);
  }
  // A low terracotta pavilion balances the domed tower without repeating its silhouette: its back
  // on the far edge, its front against the last column's plinth, its louvres on its cornice.
  const clear = columns[0] - plinth[2] / 2,
    hall = [4, 2.2, clear - far],
    hallZ = (far + clear) / 2;
  const walls = w.block(5, [7.5, pavingTop, hallZ], hall);
  const eaves = [hall[0] + 0.4, 0.25, hall[2] + 0.4];
  const roof = w.block(1, [7.5, top(walls), hallZ], eaves);
  const louvre = [0.27, 0.5, hall[2] + 0.2],
    pitch = 0.55,
    louvres = Math.floor((eaves[0] - louvre[0]) / pitch) + 1;
  for (let k = 0; k < louvres; k++)
    w.block(0, [7.5 + (k - (louvres - 1) / 2) * pitch, top(roof), hallZ], louvre);
  return { surfaces: w.surfaces, parts: w.parts };
}
