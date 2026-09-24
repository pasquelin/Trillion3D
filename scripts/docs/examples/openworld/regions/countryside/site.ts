/**
 * The ground the countryside builds on: its bounds, what it must stay off (roads, rivers, lakes)
 * and what it has already placed. Every prop goes through `place`, which refuses a spot outside
 * the bounds, on a road or in water, over another prop, or on ground too uneven for it — so the
 * output never overlaps, floats or sinks by construction, and the test checks it again.
 */
import type { Bounds, Instance, PropMesh, Road, WorldPlan } from '../../plan/contract.ts';
import {
  corners,
  localFootprint,
  overlaps,
  placedRect,
  reach,
  segmentRect,
  type Local,
  type Rect,
} from './footprint.ts';

/** Depth of every building's stone plinth below its floor, metres: the slack it can stand on. */
export const PLINTH = 2.5;
/** Clearance kept from a road's edge or a river's bank, metres. */
const CLEARANCE = 1.5;
/** Distance kept from the region's edge, metres: crowns and roofs stay inside. */
const EDGE = 25;
/** A lake the plan carved: centre, radius and water level. Not in the contract yet. */
export type Lake = { id: string; x: number; z: number; radius: number; level: number };

type Segment = { ax: number; az: number; bx: number; bz: number; half: number; water: boolean };
/** How a prop meets the ground: on a level plinth, at the mean height, or at a given height. */
export type Seat = 'plinth' | 'mean' | { y: number };
export type PlaceOptions = {
  scale?: number | readonly [number, number, number];
  seat?: Seat;
  name?: string;
  /** Allowed to stand on roads (a bridge) or in water (a bridge, a jetty). */
  onRoad?: boolean;
  inWater?: boolean;
};

const CELL = 64;
const key = (i: number, j: number) => i * 100_003 + j;

export class Site {
  readonly instances: Instance[] = [];
  readonly footprints = new Map<string, Local>();
  private readonly taken = new Map<number, Rect[]>();
  private readonly lines = new Map<number, Segment[]>();

  readonly plan: WorldPlan;
  readonly bounds: Bounds;
  readonly lakes: readonly Lake[];

  constructor(plan: WorldPlan, bounds: Bounds, lakes: readonly Lake[]) {
    this.plan = plan;
    this.bounds = bounds;
    this.lakes = lakes;
    for (const road of plan.roads) this.addLine(road.points, road.width / 2, false);
    for (const river of plan.rivers)
      river.points.forEach((p, i) => {
        if (i) this.addLine([river.points[i - 1], p], river.widths[i] / 2, true);
      });
  }

  /** Footprints of props this site may place. */
  register(props: readonly PropMesh[]) {
    for (const p of props) this.footprints.set(p.id, localFootprint(p));
  }

  /** A road of the region's own: later placements keep off it. */
  addRoad(road: Road) {
    this.addLine(road.points, road.width / 2, false);
  }

  private addLine(points: Road['points'], half: number, water: boolean) {
    const b = this.bounds;
    for (let i = 1; i < points.length; i++) {
      const [ax, , az] = points[i - 1],
        [bx, , bz] = points[i];
      if (Math.max(ax, bx) < b.minX - CELL || Math.min(ax, bx) > b.maxX + CELL) continue;
      if (Math.max(az, bz) < b.minZ - CELL || Math.min(az, bz) > b.maxZ + CELL) continue;
      const segment = { ax, az, bx, bz, half, water },
        pad = half + CLEARANCE;
      this.cells(
        Math.min(ax, bx) - pad,
        Math.min(az, bz) - pad,
        Math.max(ax, bx) + pad,
        Math.max(az, bz) + pad,
        (k) => {
          const list = this.lines.get(k);
          if (list) list.push(segment);
          else this.lines.set(k, [segment]);
        },
      );
    }
  }

  private cells(x0: number, z0: number, x1: number, z1: number, visit: (k: number) => void) {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) visit(key(i, j));
  }

  private around(r: Rect, visit: (k: number) => boolean | void) {
    const pad = reach(r);
    let stop = false;
    this.cells(r.x - pad, r.z - pad, r.x + pad, r.z + pad, (k) => {
      if (!stop && visit(k)) stop = true;
    });
    return stop;
  }

  /** True when `r` lies inside the bounds, off roads and water (unless allowed), over no prop. */
  free(r: Rect, { onRoad = false, inWater = false } = {}): boolean {
    const b = this.bounds;
    for (const [x, z] of corners(r))
      if (x < b.minX + EDGE || x > b.maxX - EDGE || z < b.minZ + EDGE || z > b.maxZ - EDGE)
        return false;
    if (
      !inWater &&
      this.lakes.some((l) => Math.hypot(l.x - r.x, l.z - r.z) < l.radius + reach(r) + CLEARANCE)
    )
      return false;
    const blocked = this.around(
      r,
      (k) =>
        (this.lines.get(k) ?? []).some(
          (s) =>
            (s.water ? !inWater : !onRoad) &&
            segmentRect(s.ax, s.az, s.bx, s.bz, r) < s.half + CLEARANCE,
        ) || (this.taken.get(k) ?? []).some((other) => overlaps(r, other)),
    );
    return !blocked;
  }

  /** Marks `r` as occupied without placing anything (a square, a clearing). */
  take(r: Rect) {
    const pad = reach(r);
    this.cells(r.x - pad, r.z - pad, r.x + pad, r.z + pad, (k) => {
      const list = this.taken.get(k);
      if (list) list.push(r);
      else this.taken.set(k, [r]);
    });
  }

  /** The seat height for a footprint, or undefined when the ground is too uneven or wet. */
  seat(r: Rect, seat: Seat): number | undefined {
    if (typeof seat === 'object') return seat.y;
    const heights = [...corners(r), [r.x, r.z]].map(([x, z]) => this.plan.height(x, z)),
      low = Math.min(...heights),
      high = Math.max(...heights);
    if (low < 1 || high - low > PLINTH) return undefined;
    return seat === 'plinth' ? high : heights.reduce((a, b) => a + b, 0) / heights.length;
  }

  /** Places `prop` at (x, z) turned by `yaw` if the spot is free; the instance, or undefined. */
  place(prop: string, x: number, z: number, yaw: number, options: PlaceOptions = {}) {
    const local = this.footprints.get(prop);
    if (!local) throw new Error(`countryside: no footprint for "${prop}"`);
    const { scale, seat = 'mean', name } = options,
      r = placedRect(local, { position: [x, 0, z], yaw, scale });
    if (!this.free(r, options)) return undefined;
    const y = this.seat(r, seat);
    if (y === undefined) return undefined;
    const instance: Instance = {
      prop,
      position: [x, y, z],
      yaw,
      ...(scale === undefined ? {} : { scale }),
      ...(name ? { name } : {}),
    };
    this.take(r);
    this.instances.push(instance);
    return instance;
  }
}
