/**
 * One step of grid-based hydraulic erosion (#332), after Mei, Decaudin & Hu, "Fast Hydraulic
 * Erosion Simulation and Visualization on GPU" (Pacific Graphics 2007), run on the CPU over typed
 * arrays. Each cell holds ground `b`, water `d` and suspended sediment `s`; virtual pipes carry
 * water to the four neighbours (the shallow-water pipe model), the flow's speed sets how much
 * sediment it can carry, and the ground gives or takes the difference. Sea cells are sinks: water
 * and sediment that reach them leave the map (a sink sends no flux).
 */

/** Gravity, m/s². */
export const GRAVITY = 9.81;
/**
 * Share of the gap between capacity and load that one step dissolves or settles: one half, the
 * explicit schemes' stability rule (a step closes at most half of any imbalance), as the pipe
 * flux and the talus slide use it; the creep is sized against it. Mei et al. leave these rates
 * free; this one is not derived from the terrain. Sensitivity: the depth of the cuts grows
 * about linearly with it up to one.
 */
export const EXCHANGE = 0.5;

export type Field = {
  side: number;
  /** Cell size, metres. */
  cell: number;
  /** Time step, seconds. */
  dt: number;
  b: Float32Array;
  d: Float32Array;
  s: Float32Array;
  carried: Float32Array;
  /** Outflow fluxes to −X, +X, −Z, +Z, m³/s. */
  fw: Float32Array;
  fe: Float32Array;
  fn: Float32Array;
  fs: Float32Array;
  u: Float32Array;
  v: Float32Array;
  /** The rock surface: the lowest the ground has been; what lies above it is loose. */
  rock: Float32Array;
  /** Lowest the ground may be eroded to: the coastline never moves. */
  floor: Float32Array;
  sea: Uint8Array;
  /** Sum over the run of the unit discharge `d·|v|`, m²/s. */
  discharge: Float32Array;
};

/**
 * Rain, then the pipe outflows (Mei et al. §3.1, §3.2.1), scaled so a cell never sends more
 * water than it holds. The grid's border is a sink, so every cell visited has four neighbours.
 */
export function outflow(f: Field, rain: number) {
  const { side, cell, dt, b, d, fw, fe, fn, fs, sea } = f,
    // The pipe's cross-section is one cell face, A = l², so dt·A·g / l = dt·l·g.
    k = dt * cell * GRAVITY,
    area = cell * cell;
  for (let j = 1; j < side - 1; j++)
    for (let i = 1; i < side - 1; i++) {
      const c = j * side + i;
      if (sea[c]) continue;
      const water = (d[c] += rain),
        h = b[c] + water,
        w = Math.max(0, fw[c] + k * (h - b[c - 1] - d[c - 1])),
        e = Math.max(0, fe[c] + k * (h - b[c + 1] - d[c + 1])),
        n = Math.max(0, fn[c] + k * (h - b[c - side] - d[c - side])),
        s = Math.max(0, fs[c] + k * (h - b[c + side] - d[c + side])),
        sum = (w + e + n + s) * dt,
        scale = sum > water * area ? (water * area) / sum : 1;
      fw[c] = w * scale;
      fe[c] = e * scale;
      fn[c] = n * scale;
      fs[c] = s * scale;
    }
}

/**
 * Water balance, velocity (§3.2.2), erosion–deposition (§3.3) and evaporation (§3.5). The
 * capacity is Mei's `Kc·sin α·|v|` with `Kc = dt`: the flow lifts at most the height it falls in
 * one step, and never more than its own depth of sediment.
 */
export function exchange(f: Field, evaporation: number) {
  const { side, cell, dt, b, d, s, fw, fe, fn, fs, u, v, rock, floor, sea, discharge } = f,
    area = cell * cell,
    top = cell / dt;
  for (let j = 1; j < side - 1; j++)
    for (let i = 1; i < side - 1; i++) {
      const c = j * side + i;
      if (sea[c]) continue;
      const [west, east, north, south] = [c - 1, c + 1, c - side, c + side],
        inflow = fe[west] + fw[east] + fs[north] + fn[south],
        before = d[c],
        after = Math.max(0, before + (dt * (inflow - fw[c] - fe[c] - fn[c] - fs[c])) / area),
        mean = (before + after) / 2;
      d[c] = after * (1 - evaporation);
      let vx = 0,
        vz = 0;
      if (mean > 0) {
        vx = (fe[west] - fw[c] + fe[c] - fw[east]) / (2 * cell * mean);
        vz = (fs[north] - fn[c] + fs[c] - fn[south]) / (2 * cell * mean);
        vx = vx > top ? top : vx < -top ? -top : vx;
        vz = vz > top ? top : vz < -top ? -top : vz;
      }
      u[c] = vx;
      v[c] = vz;
      const speed = Math.sqrt(vx * vx + vz * vz);
      discharge[c] += after * speed;
      // The tilt is read toward the cell the water heads for: a central difference would not
      // see a ripple one cell wide, and the water would carve it unchecked.
      const gx = (vx > 0 ? b[east] - b[c] : b[c] - b[west]) / cell,
        gz = (vz > 0 ? b[south] - b[c] : b[c] - b[north]) / cell,
        g2 = gx * gx + gz * gz,
        capacity = Math.min(Math.sqrt(g2 / (1 + g2)) * speed * dt, after);
      if (capacity > s[c]) {
        const taken = Math.min(EXCHANGE * (capacity - s[c]), b[c] - floor[c]);
        if (taken <= 0) continue;
        b[c] -= taken;
        s[c] += taken;
        if (b[c] < rock[c]) rock[c] = b[c];
      } else {
        const settled = EXCHANGE * (s[c] - capacity);
        b[c] += settled;
        s[c] -= settled;
      }
    }
}

/** Sediment moves with the water, semi-Lagrangian (§3.4): each cell reads where it came from. */
export function advect(f: Field) {
  const { side, cell, dt, s, carried, u, v, sea } = f,
    last = side - 1;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const c = j * side + i;
      if (sea[c]) {
        carried[c] = 0;
        continue;
      }
      const x = Math.max(0, Math.min(last, i - (u[c] * dt) / cell)),
        z = Math.max(0, Math.min(last, j - (v[c] * dt) / cell)),
        i0 = Math.min(last - 1, Math.floor(x)),
        j0 = Math.min(last - 1, Math.floor(z)),
        fx = x - i0,
        fz = z - j0,
        a = j0 * side + i0;
      carried[c] =
        (s[a] * (1 - fx) + s[a + 1] * fx) * (1 - fz) +
        (s[a + side] * (1 - fx) + s[a + side + 1] * fx) * fz;
    }
  s.set(carried);
}
