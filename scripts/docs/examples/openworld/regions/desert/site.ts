/**
 * Placing props on the plan's ground: every node gets its footprint (an oriented rectangle), is
 * refused when that rectangle leaves the region, touches another footprint, a road or a river,
 * or stands on ground steeper than its plinth absorbs, and otherwise sits on the lowest ground
 * under it (minus the sink it allows). A uniform grid keeps every query local.
 */
import {
  WORLD,
  type Bounds,
  type Instance,
  type Road,
  type Vec3,
  type WorldPlan,
} from '../../plan/contract.ts';
import type { Footprint } from './catalog.ts';
import { overlaps, segmentDistance, type Point } from './geometry2.ts';

const CELL = 64;
const key = (i: number, j: number) => `${i},${j}`;

/** A ground line props keep clear of: a road or a river segment, with its half-width. */
type Line = { a: Point; b: Point; half: number };

/** The instance's scale as three axes. */
export const axes = (scale: Instance['scale']): Vec3 =>
  scale === undefined ? [1, 1, 1] : typeof scale === 'number' ? [scale, scale, scale] : scale;

/** The four world corners of `fp` under an instance at (x, z), `yaw`, horizontal scale. */
export function corners(fp: Footprint, x: number, z: number, yaw: number, sx = 1, sz = 1): Point[] {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [
    [fp.minX, fp.minZ],
    [fp.maxX, fp.minZ],
    [fp.maxX, fp.maxZ],
    [fp.minX, fp.maxZ],
  ].map(([lx, lz]) => [x + lx * sx * c + lz * sz * s, z - lx * sx * s + lz * sz * c] as Point);
}

export type PlaceOptions = { scale?: number | Vec3; name?: string; clearance?: number };

export class Site {
  readonly instances: Instance[] = [];
  /** Nodes the site accepts; `place` refuses past it. */
  limit = Infinity;
  private readonly shapes: Point[][] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly lines = new Map<string, Line[]>();

  readonly plan: WorldPlan;
  readonly bounds: Bounds;
  readonly needs: ReadonlyMap<string, Footprint>;

  constructor(plan: WorldPlan, bounds: Bounds, needs: ReadonlyMap<string, Footprint>) {
    this.plan = plan;
    this.bounds = bounds;
    this.needs = needs;
    for (const road of plan.roads) this.keepClear(road);
    for (const river of plan.rivers)
      for (let i = 0; i + 1 < river.points.length; i++)
        this.addLine(
          river.points[i],
          river.points[i + 1],
          Math.max(river.widths[i], river.widths[i + 1]) / 2,
        );
  }

  /** Keeps every later prop off `road` (the plan's roads, and the region's own). */
  keepClear(road: Road) {
    for (let i = 0; i + 1 < road.points.length; i++)
      this.addLine(road.points[i], road.points[i + 1], road.width / 2);
  }

  private addLine(a: Vec3, b: Vec3, half: number) {
    const { minX, minZ, maxX, maxZ } = this.bounds,
      margin = half + 100;
    if (Math.max(a[0], b[0]) < minX - margin || Math.min(a[0], b[0]) > maxX + margin) return;
    if (Math.max(a[2], b[2]) < minZ - margin || Math.min(a[2], b[2]) > maxZ + margin) return;
    const line: Line = { a: [a[0], a[2]], b: [b[0], b[2]], half },
      reach = half + 40;
    this.forCells(
      Math.min(a[0], b[0]) - reach,
      Math.min(a[2], b[2]) - reach,
      Math.max(a[0], b[0]) + reach,
      Math.max(a[2], b[2]) + reach,
      (k) => {
        const list = this.lines.get(k);
        if (list) list.push(line);
        else this.lines.set(k, [line]);
      },
    );
  }

  private forCells(x0: number, z0: number, x1: number, z1: number, visit: (k: string) => void) {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) visit(key(i, j));
  }

  /** Lowest and highest ground under a footprint, sampled at most every 6 m. */
  ground(shape: readonly Point[]): { min: number; max: number } {
    const [a, b, , d] = shape,
      nu = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)),
      nv = Math.max(1, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1]) / 6));
    let min = Infinity,
      max = -Infinity;
    for (let u = 0; u <= nu; u++)
      for (let v = 0; v <= nv; v++) {
        const x = a[0] + ((b[0] - a[0]) * u) / nu + ((d[0] - a[0]) * v) / nv,
          z = a[1] + ((b[1] - a[1]) * u) / nu + ((d[1] - a[1]) * v) / nv,
          h = this.plan.height(x, z);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    return { min, max };
  }

  /** Whether `shape` is inside the region and clear of every road, river and footprint. */
  free(shape: readonly Point[], clearance = 0.5): boolean {
    const { minX, minZ, maxX, maxZ } = this.bounds;
    if (shape.some(([x, z]) => x < minX || x > maxX || z < minZ || z > maxZ)) return false;
    const xs = shape.map((p) => p[0]),
      zs = shape.map((p) => p[1]);
    let clear = true;
    const seen = new Set<number>();
    this.forCells(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (k) => {
      if (!clear) return;
      for (const line of this.lines.get(k) ?? [])
        if (segmentDistance(shape, line.a, line.b) < line.half + clearance) clear = false;
      for (const i of this.cells.get(k) ?? [])
        if (!seen.has(i) && (seen.add(i), overlaps(shape, this.shapes[i]))) clear = false;
    });
    return clear;
  }

  /** Places `prop` at (x, z) if its ground allows; returns the instance, or nothing. */
  place(
    prop: string,
    x: number,
    z: number,
    yaw: number,
    { scale, name, clearance }: PlaceOptions = {},
  ) {
    const fp = this.needs.get(prop);
    if (!fp) throw new Error(`desert: no footprint for "${prop}"`);
    if (this.instances.length >= this.limit) return undefined;
    const [sx, sy, sz] = axes(scale),
      shape = corners(fp, x, z, yaw, sx, sz);
    if (!this.free(shape, clearance)) return undefined;
    const { min, max } = this.ground(shape);
    // Nothing stands in the sea, nor on ground steeper than its plinth absorbs.
    if (min < WORLD.seaLevel + 0.5 || max - min > fp.plinth * sy) return undefined;
    const instance: Instance = {
      prop,
      position: [x, min - fp.sink * sy, z],
      yaw,
      ...(scale === undefined ? {} : { scale }),
      ...(name ? { name } : {}),
    };
    this.claim(shape);
    this.instances.push(instance);
    return instance;
  }

  /** Reserves `shape` without a node (a car park, a square kept open). */
  claim(shape: Point[]) {
    const index = this.shapes.push(shape) - 1,
      xs = shape.map((p) => p[0]),
      zs = shape.map((p) => p[1]);
    this.forCells(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (k) => {
      const list = this.cells.get(k);
      if (list) list.push(index);
      else this.cells.set(k, [index]);
    });
  }
}
