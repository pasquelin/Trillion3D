/**
 * Placing props without collisions: every node carries its footprint (oriented rectangles on
 * the ground). A solid never overlaps another solid, a road or the region's edge; a pad (a paved
 * slab) never overlaps a road or another pad; paint lies anywhere. Whatever fails is not placed,
 * so the layout stays sound on any plan. Heights come from the plan, and from the pads, so a
 * node stands on the highest ground under its footprint and its foundation reaches the lowest.
 */
import type { Instance, Road, WorldPlan } from '../../plan/contract.ts';
import { corners, inside, overlaps, type Rect } from './rect.ts';

export type Layer = 'solid' | 'pad' | 'paint';
/**
 * A footprint in the prop's own frame: `[x, z, half width, half depth]` before scale, and an
 * optional yaw of that rectangle within the prop.
 */
export type Footprint = readonly (readonly [number, number, number, number, number?])[];
/** A placed node; `on` names the node it is stacked on, when it does not stand on the ground. */
export type Placed = {
  instance: Instance;
  rects: Rect[];
  layer: Layer;
  bottom: number;
  on?: number;
};
export type PlaceOptions = { scale?: Instance['scale']; name?: string; reach?: number };

const CELL = 100;

/** World (x, z) of a point given in the frame of a node at (x, z) turned by `yaw`. */
const frameOf =
  ([x, z]: readonly [number, number], yaw: number) =>
  (fx: number, fz: number): [number, number] => {
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    return [x + fx * c + fz * s, z - fx * s + fz * c];
  };

export class Placer {
  readonly placed: Placed[] = [];
  private readonly cells = new Map<string, { rect: Rect; layer: Layer | 'road' }[]>();
  private readonly pads: { rect: Rect; top: number }[] = [];

  private readonly plan: WorldPlan;

  constructor(plan: WorldPlan, roads: readonly Road[]) {
    this.plan = plan;
    const { minX, minZ, maxX, maxZ } = plan.regions.airport.bounds;
    for (const road of roads)
      for (let i = 0; i + 1 < road.points.length; i++) {
        const [a, b] = [road.points[i], road.points[i + 1]];
        const x = (a[0] + b[0]) / 2,
          z = (a[2] + b[2]) / 2;
        if (x < minX - CELL || x > maxX + CELL || z < minZ - CELL || z > maxZ + CELL) continue;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
        this.index({ x, z, hw: road.width / 2, hd: length / 2 + road.width / 2, yaw }, 'road');
      }
  }

  /** Ground height at (x, z): the plan's, or the top of a pad laid there. */
  groundAt(x: number, z: number): number {
    let y = this.plan.height(x, z);
    for (const pad of this.pads) if (inside(pad.rect, x, z)) y = Math.max(y, pad.top);
    return y;
  }

  /** Places `prop` at world (x, z) turned by `yaw`, or refuses it; true when placed. */
  place(
    prop: string,
    [x, z]: readonly [number, number],
    yaw: number,
    footprint: Footprint,
    layer: Layer,
    { scale = 1, name, reach = 0 }: PlaceOptions = {},
  ): boolean {
    const [sx, sy, sz] = typeof scale === 'number' ? [scale, scale, scale] : scale,
      frame = frameOf([x, z], yaw);
    const rects = footprint.map(([fx, fz, hw, hd, turn = 0]): Rect => {
      const [rx, rz] = frame(fx * sx, fz * sz);
      return { x: rx, z: rz, hw: hw * sx, hd: hd * sz, yaw: yaw + turn };
    });
    if (layer !== 'paint' && !rects.every((rect) => this.inBounds(rect))) return false;
    if (layer !== 'paint' && rects.some((rect) => this.blocked(rect, layer))) return false;
    const samples = rects.flatMap(samplePoints);
    const ground = samples.map(([px, pz]) =>
      layer === 'pad' ? this.plan.height(px, pz) : this.groundAt(px, pz),
    );
    const high = Math.max(...ground),
      low = Math.min(...ground);
    let y = high,
      finalScale = scale;
    if (layer === 'paint') y = this.groundAt(x, z) + 0.03;
    if (layer === 'pad') {
      y = high + 0.1;
      const thick = y - low + 0.5;
      finalScale = [sx, thick, sz];
      for (const rect of rects) this.pads.push({ rect, top: y });
    }
    const instance: Instance = { prop, position: [x, y, z], yaw, scale: finalScale };
    if (name) instance.name = name;
    const bottom = layer === 'pad' ? y - (y - low + 0.5) : y - reach * sy;
    this.placed.push({ instance, rects, layer, bottom });
    if (layer !== 'paint') for (const rect of rects) this.index(rect, layer);
    return true;
  }

  /** Stacks another node of `prop` on the node `below`, `height` above it, same turn. */
  stack(prop: string, below: number, height: number) {
    this.inside(prop, below, [0, height, 0], 0);
  }

  /**
   * Places a node on a floor of the node `host` (a deck, a stack): `at` in the host's frame,
   * `turn` added to its yaw. It rests on the host, not on the ground.
   */
  inside(prop: string, host: number, [hx, hy, hz]: readonly number[], turn: number) {
    const base = this.placed[host].instance,
      [x, z] = frameOf([base.position[0], base.position[2]], base.yaw)(hx, hz),
      y = base.position[1] + hy;
    this.placed.push({
      instance: { prop, position: [x, y, z], yaw: base.yaw + turn },
      rects: [],
      layer: 'solid',
      bottom: y,
      on: host,
    });
  }

  get instances(): Instance[] {
    return this.placed.map((p) => p.instance);
  }

  private inBounds(rect: Rect) {
    const { minX, minZ, maxX, maxZ } = this.plan.regions.airport.bounds;
    return corners(rect).every(([x, z]) => x >= minX && x <= maxX && z >= minZ && z <= maxZ);
  }

  private blocked(rect: Rect, layer: Layer) {
    for (const key of cellKeys(rect))
      for (const other of this.cells.get(key) ?? []) {
        const clash = other.layer === 'road' || other.layer === layer;
        if (clash && overlaps(rect, other.rect)) return true;
      }
    return false;
  }

  private index(rect: Rect, layer: Layer | 'road') {
    for (const key of cellKeys(rect)) {
      const list = this.cells.get(key);
      if (list) list.push({ rect, layer });
      else this.cells.set(key, [{ rect, layer }]);
    }
  }
}

function cellKeys(rect: Rect): string[] {
  const points = corners(rect),
    xs = points.map((p) => Math.floor(p[0] / CELL)),
    zs = points.map((p) => Math.floor(p[1] / CELL)),
    keys: string[] = [];
  for (let i = Math.min(...xs); i <= Math.max(...xs); i++)
    for (let j = Math.min(...zs); j <= Math.max(...zs); j++) keys.push(`${i},${j}`);
  return keys;
}

/** Corners, centre, and a lattice no coarser than 25 m for large footprints. */
function samplePoints(rect: Rect): [number, number][] {
  const nx = Math.max(1, Math.ceil((rect.hw * 2) / 25)),
    nz = Math.max(1, Math.ceil((rect.hd * 2) / 25)),
    [c, s] = [Math.cos(rect.yaw), Math.sin(rect.yaw)],
    points: [number, number][] = [[rect.x, rect.z]];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const a = (i / nx - 0.5) * 2 * rect.hw,
        b = (j / nz - 0.5) * 2 * rect.hd;
      points.push([rect.x + a * c + b * s, rect.z - a * s + b * c]);
    }
  return points;
}
