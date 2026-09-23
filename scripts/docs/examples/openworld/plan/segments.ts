/**
 * A grid index of line segments over the map (#332): each cell lists the segments whose reach
 * (half-width plus shoulder) touches it, so a height or paint query visits only the few roads or
 * rivers near its point, not the whole network.
 */
import { WORLD } from './contract.ts';

/** Cell of the index, metres: a quarter tile, near the widest reach a road or river carves. */
const CELL = WORLD.tile / 4;
const SIDE = WORLD.size / CELL;
const HALF = WORLD.size / 2;

/** A point's position on a segment: `t` along it (0–1) and its distance to it, metres. */
export type Hit = { segment: number; t: number; distance: number };

export class SegmentIndex {
  readonly ax: number[] = [];
  readonly az: number[] = [];
  readonly bx: number[] = [];
  readonly bz: number[] = [];
  readonly reach: number[] = [];
  private readonly cells: number[][] = Array.from({ length: SIDE * SIDE }, () => []);

  /** Adds a segment reaching `reach` metres on each side; returns its index. */
  add(ax: number, az: number, bx: number, bz: number, reach: number): number {
    const index = this.ax.length;
    this.ax.push(ax);
    this.az.push(az);
    this.bx.push(bx);
    this.bz.push(bz);
    this.reach.push(reach);
    const cell = (value: number) =>
      Math.min(SIDE - 1, Math.max(0, Math.floor((value + HALF) / CELL)));
    const [x0, x1] = [cell(Math.min(ax, bx) - reach), cell(Math.max(ax, bx) + reach)],
      [z0, z1] = [cell(Math.min(az, bz) - reach), cell(Math.max(az, bz) + reach)];
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) this.cells[cz * SIDE + cx].push(index);
    return index;
  }

  /** Every segment whose reach covers (x, z), with where the point projects on it. */
  near(x: number, z: number, out: Hit[] = []): Hit[] {
    out.length = 0;
    const cx = Math.floor((x + HALF) / CELL),
      cz = Math.floor((z + HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= SIDE || cz >= SIDE) return out;
    for (const segment of this.cells[cz * SIDE + cx]) {
      const hit = this.project(segment, x, z);
      if (hit.distance <= this.reach[segment]) out.push(hit);
    }
    return out;
  }

  project(segment: number, x: number, z: number): Hit {
    const ax = this.ax[segment],
      az = this.az[segment],
      dx = this.bx[segment] - ax,
      dz = this.bz[segment] - az,
      length2 = dx * dx + dz * dz,
      t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
    return { segment, t, distance: Math.hypot(x - ax - t * dx, z - az - t * dz) };
  }
}
