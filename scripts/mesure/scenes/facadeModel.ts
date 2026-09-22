// The facade block: four walls around a rectangular plan, pierced by windows, each wall carrying
// one of three texture-coordinate layouts.
//
// Nothing here is a number someone liked: the plan, the number of storeys and which bays are
// windows are drawn from the seed; the subdivision is whatever reaches the requested triangle
// count; the bay — one storey tall, one bay wide — is the scene's unit, and every length is
// counted in it. Two seeds give two different blocks with the same guarantees.

/** The three ways a wall lays its texture coordinates out, one per wall around the block, and
 *  `per-brick`, asked for every wall at once: each cell of the bay's cut owns its four corners and
 *  maps the whole texture, one island per brick, so every position is a seam corner. */
export type UvLayout = 'per-wall' | 'per-window' | 'mirrored' | 'per-brick';
export const UV_LAYOUTS: UvLayout[] = ['per-wall', 'per-window', 'mirrored'];

export interface WallMesh {
  name: string;
  layout: UvLayout;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** `mulberry32`: a seeded generator in four lines, so a seed alone reproduces a block. */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** The plan of the block, in bays: two side lengths, a height, and which bays are open. */
export function facadePlan(seed: number) {
  const draw = random(seed);
  const between = (low: number, high: number) => low + Math.floor(draw() * (high + 1 - low));
  // A block is longer than it is tall and wider than one room: between six and twelve bays a
  // side, between four and eight storeys. The ranges are the block's, not a measurement's.
  const bays = [between(6, 12), between(6, 12)];
  const storeys = between(4, 8);
  // A bay is a window above the ground floor and solid on it — a rule of the building, not a
  // threshold: above it, open or solid is drawn as evenly as a coin.
  const windows = bays.map((count) =>
    Array.from({ length: count * storeys }, (_, cell) => cell >= count && draw() < 0.5),
  );
  return { bays, storeys, windows };
}

/** How finely each solid bay is cut so the four walls together reach `triangles`. */
export function baySubdivision(plan: ReturnType<typeof facadePlan>, triangles: number) {
  const solid =
    plan.windows.reduce((sum, wall) => sum + wall.filter((open) => !open).length, 0) * 2;
  return Math.max(1, Math.round(Math.sqrt(triangles / (2 * solid))));
}

/** One wall, seen from outside: where it starts, which way it runs, and which way it faces. */
function wallFrames(width: number, depth: number) {
  const x = width / 2,
    z = depth / 2;
  return [
    { origin: [-x, 0, -z], along: [1, 0, 0], normal: [0, 0, -1], length: width },
    { origin: [x, 0, -z], along: [0, 0, 1], normal: [1, 0, 0], length: depth },
    { origin: [x, 0, z], along: [-1, 0, 0], normal: [0, 0, 1], length: width },
    { origin: [-x, 0, z], along: [0, 0, -1], normal: [-1, 0, 0], length: depth },
  ];
}

/** Texture coordinate of a point of a wall, under the layout that wall carries. */
export function uvAt(layout: UvLayout, t: number, h: number, bayU: number, bayV: number) {
  if (layout === 'per-window') return [bayU, bayV];
  // Mirrored halves: the coordinate climbs to the middle of the wall and comes back down, so the
  // image is reflected about a seam no simplification may cross without folding the texture.
  if (layout === 'mirrored') return [t < 0.5 ? 2 * t : 2 * (1 - t), h];
  return [t, h];
}

/** The four walls of the block, in the order `UV_LAYOUTS` repeats through, or all `per-brick`. */
export function facadeWalls(
  plan: ReturnType<typeof facadePlan>,
  subdivision: number,
  bricks = false,
): WallMesh[] {
  const [baysX, baysZ] = plan.bays,
    height = plan.storeys;
  const frames = wallFrames(baysX, baysZ);
  return frames.map((frame, index) => {
    const layout: UvLayout = bricks ? 'per-brick' : UV_LAYOUTS[index % UV_LAYOUTS.length];
    const columns = index % 2 === 0 ? baysX : baysZ;
    const open = plan.windows[index % 2];
    const positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    // One vertex at `(u, v)` of the bay's cut, whose texture coordinate the layout gives.
    const vertex = (column: number, row: number, u: number, v: number, uv?: number[]) => {
      const bayU = u / subdivision,
        bayV = v / subdivision,
        t = (column + bayU) / columns,
        h = (row + bayV) / height,
        run = t * frame.length;
      positions.push(
        frame.origin[0] + frame.along[0] * run,
        h * height,
        frame.origin[2] + frame.along[2] * run,
      );
      normals.push(...frame.normal);
      uvs.push(...(uv ?? uvAt(layout, t, h, bayU, bayV)));
    };
    for (let row = 0; row < height; row++)
      for (let column = 0; column < columns; column++) {
        if (open[row * columns + column]) continue;
        const base = positions.length / 3;
        if (bricks) {
          // Each cell writes its own four corners, corner `c` at `(c & 1, c >> 1)` of the cell.
          for (let v = 0; v < subdivision; v++)
            for (let u = 0; u < subdivision; u++) {
              const first = positions.length / 3;
              for (let c = 0; c < 4; c++)
                vertex(column, row, u + (c & 1), v + (c >> 1), [c & 1, c >> 1]);
              indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
            }
          continue;
        }
        for (let v = 0; v <= subdivision; v++)
          for (let u = 0; u <= subdivision; u++) vertex(column, row, u, v);
        for (let v = 0; v < subdivision; v++)
          for (let u = 0; u < subdivision; u++) {
            const a = base + v * (subdivision + 1) + u;
            indices.push(
              a,
              a + subdivision + 1,
              a + 1,
              a + 1,
              a + subdivision + 1,
              a + subdivision + 2,
            );
          }
      }
    return {
      name: `wall-${index}-${layout}`,
      layout,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
    };
  });
}
