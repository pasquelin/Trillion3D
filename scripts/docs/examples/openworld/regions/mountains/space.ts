/**
 * Where a prop may stand: inside the region, on ground the region owns, off every road, clear
 * of every other prop. A footprint is the circle that holds the mesh seen from above (its
 * vertices' largest distance from the axis, times the instance's scale); `Placer` seats each
 * prop on the ground the plan gives and keeps the circles in a grid.
 */
import type { Bounds, Instance, PropMesh, Road, Vec3, WorldPlan } from '../../plan/contract.ts';
import { slopeOf } from './terrain.ts';

/** The radius of the circle, about the mesh's own Y axis, that holds every vertex. */
export function footprintRadius(mesh: PropMesh): number {
  let r = 0;
  for (const { positions } of mesh.parts)
    for (let v = 0; v < positions.length; v += 3)
      r = Math.max(r, Math.hypot(positions[v], positions[v + 2]));
  return r;
}

/** An instance's footprint circle, given its mesh's radius. */
function footprintOf(instance: Instance, radius: number) {
  const s = instance.scale ?? 1,
    k = typeof s === 'number' ? s : Math.max(s[0], s[2]);
  return { x: instance.position[0], z: instance.position[2], r: radius * k };
}

/** A footprint; circles of one `group` (the spans of a bridge) may touch each other. */
type Circle = { x: number; z: number; r: number; group?: string };

/** Circles in a uniform grid: each is filed under every cell its bounding square touches. */
class Occupancy {
  private readonly cells = new Map<number, Circle[]>();
  private readonly cell = 32;
  private keys({ x, z, r }: Circle): number[] {
    const keys: number[] = [];
    for (let i = Math.floor((x - r) / this.cell); i <= Math.floor((x + r) / this.cell); i++)
      for (let j = Math.floor((z - r) / this.cell); j <= Math.floor((z + r) / this.cell); j++)
        keys.push(i * 1_000_003 + j);
    return keys;
  }
  /** The first circle `c` overlaps, if any. */
  hit(c: Circle): Circle | undefined {
    for (const key of this.keys(c))
      for (const o of this.cells.get(key) ?? [])
        if ((!c.group || o.group !== c.group) && Math.hypot(o.x - c.x, o.z - c.z) < o.r + c.r)
          return o;
    return undefined;
  }
  add(c: Circle) {
    for (const key of this.keys(c)) {
      const list = this.cells.get(key);
      if (list) list.push(c);
      else this.cells.set(key, [c]);
    }
  }
}

/** Road segments in a grid: how far a circle stays from every road's edge. */
export class RoadIndex {
  private readonly cells = new Map<number, [Vec3, Vec3, number][]>();
  private readonly cell = 200;
  constructor(roads: readonly Road[]) {
    for (const road of roads)
      for (let i = 0; i + 1 < road.points.length; i++) {
        const a = road.points[i],
          b = road.points[i + 1],
          half = road.width / 2;
        for (const key of this.keys(
          Math.min(a[0], b[0]) - half,
          Math.min(a[2], b[2]) - half,
          Math.max(a[0], b[0]) + half,
          Math.max(a[2], b[2]) + half,
        ))
          (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push([a, b, half]);
      }
  }
  private keys(minX: number, minZ: number, maxX: number, maxZ: number) {
    const keys: number[] = [];
    for (let i = Math.floor(minX / this.cell); i <= Math.floor(maxX / this.cell); i++)
      for (let j = Math.floor(minZ / this.cell); j <= Math.floor(maxZ / this.cell); j++)
        keys.push(i * 1_000_003 + j);
    return keys;
  }
  /** Distance from (x, z) to the nearest road edge within `reach` (negative on the road). */
  clearance(x: number, z: number, reach: number): number {
    let best = Infinity;
    for (const key of this.keys(x - reach, z - reach, x + reach, z + reach))
      for (const [a, b, half] of this.cells.get(key) ?? []) {
        const dx = b[0] - a[0],
          dz = b[2] - a[2],
          t = Math.max(
            0,
            Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)),
          );
        best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) - half);
      }
    return best;
  }
}

const inside = (b: Bounds, x: number, z: number, margin = 0) =>
  x - margin >= b.minX && x + margin <= b.maxX && z - margin >= b.minZ && z + margin <= b.maxZ;

export type PlaceOptions = {
  yaw?: number;
  scale?: number | Vec3;
  name?: string;
  /** `centre`: stand on the ground under the axis; `high`: floor on the highest ground under it. */
  seat?: 'centre' | 'high';
  /** Metres the seat sinks below the ground (rocks, roots). */
  sink?: number;
  /** For `high` seats: the drop the prop's own base hides; steeper ground is refused. */
  basement?: number;
  /** Refused above this slope (ground-layer unit) under the axis. */
  maxSlope?: number;
  /** Stands on a road on purpose (a tunnel portal, a bridge span). */
  onRoad?: boolean;
  /** An explicit height instead of a seat. */
  y?: number;
  /** Parts of one structure: their footprints may overlap each other. */
  group?: string;
};

/** Seats props on the plan's ground, keeping every footprint apart and off the roads. */
export class Placer {
  readonly instances: Instance[] = [];
  readonly taken = new Occupancy();
  readonly plan: WorldPlan;
  readonly bounds: Bounds;
  readonly roads: RoadIndex;
  readonly maxNodes: number;
  private readonly radii: Map<string, number>;
  constructor(
    plan: WorldPlan,
    bounds: Bounds,
    roads: RoadIndex,
    radii: Map<string, number>,
    maxNodes: number,
  ) {
    [this.plan, this.bounds, this.roads, this.radii, this.maxNodes] = [
      plan,
      bounds,
      roads,
      radii,
      maxNodes,
    ];
  }
  /** Makes `mesh` placeable: its footprint radius joins the table. */
  register(mesh: PropMesh) {
    this.radii.set(mesh.id, footprintRadius(mesh));
    return mesh;
  }
  owns = (x: number, z: number, margin = 0) =>
    inside(this.bounds, x, z, margin) && this.plan.biome(x, z).owner === 'mountains';
  radius(prop: string, scale: number | Vec3 = 1) {
    return footprintOf({ prop, position: [0, 0, 0], yaw: 0, scale }, this.radii.get(prop)!).r;
  }
  /** The lowest and highest ground at the centre and on a ring of `r`. */
  footing(x: number, z: number, r: number) {
    const heights = [this.plan.height(x, z)];
    for (let k = 0; k < 8; k++)
      heights.push(this.plan.height(x + r * Math.cos(k * 0.785), z + r * Math.sin(k * 0.785)));
    return { min: Math.min(...heights), max: Math.max(...heights) };
  }
  /** The instance `prop` would be at (x, z) if every rule holds, without placing it. */
  fit(prop: string, x: number, z: number, o: PlaceOptions = {}): Instance | undefined {
    const r = this.radius(prop, o.scale);
    if (this.instances.length >= this.maxNodes || !this.owns(x, z, r)) return undefined;
    if (!o.onRoad && this.roads.clearance(x, z, r + 30) < r) return undefined;
    if (this.taken.hit({ x, z, r, group: o.group })) return undefined;
    if (o.maxSlope !== undefined && slopeOf(this.plan.height, x, z) > o.maxSlope) return undefined;
    let y = o.y;
    if (y === undefined && o.seat === 'high') {
      const ground = this.footing(x, z, r * 0.7);
      if (ground.max - ground.min > (o.basement ?? 0)) return undefined;
      y = ground.max;
    }
    y ??= this.plan.height(x, z) - (o.sink ?? 0);
    const instance: Instance = { prop, position: [x, y, z], yaw: o.yaw ?? 0 };
    if (o.scale !== undefined && o.scale !== 1) instance.scale = o.scale;
    if (o.name) instance.name = o.name;
    return instance;
  }
  /** Places a fitted instance: its footprint is taken from now on. */
  commit(instance: Instance, group?: string): Instance {
    const [x, , z] = instance.position;
    this.taken.add({ x, z, r: this.radius(instance.prop, instance.scale), group });
    this.instances.push(instance);
    return instance;
  }
  /** Places `prop` at (x, z) when every rule holds; returns the instance or nothing. */
  place(prop: string, x: number, z: number, o: PlaceOptions = {}): Instance | undefined {
    const instance = this.fit(prop, x, z, o);
    return instance && this.commit(instance, o.group);
  }
}
