/**
 * The region's placement ledger. `place` puts one prop down only when its footprint stays inside
 * the region, clear of every road and of every prop already placed, and on ground flat enough
 * for it; it seats the prop by how it meets the world (`seatOf`) and lights its lamps. Sites
 * call it and move on when it refuses: the ledger, not each site, guarantees the rules.
 */
import type {
  Bounds,
  Instance,
  LampLight,
  Marker,
  Mover,
  PropMesh,
  Road,
} from '../../../plan/contract.ts';
import { hash01, placeLamps } from '../../../props/index.ts';
import { PROP_LAMPS, seatOf } from '../props/index.ts';
import {
  corners,
  extentOf,
  overlaps,
  rectOf,
  roadIndex,
  type Extent,
  type Rect,
} from './footprint.ts';
import type { CoastMap } from './map.ts';

/** Bucket size of the footprint index, metres: about the largest common prop. */
const CELL = 32;

export type PlaceOptions = {
  scale?: Instance['scale'];
  /** Height for `deck` props (walking level) or `face` props (foot), world metres. */
  y?: number;
  /** Largest ground rise under a `ground` prop, metres. */
  maxRise?: number;
  /** A `ground` prop that may stand in the water, on the sea bed (a rock in the surf). */
  wet?: boolean;
  /** A bridge bay: it carries a road, so it is not kept off roads. */
  onRoad?: boolean;
  name?: string;
};

export class Layout {
  readonly instances: Instance[] = [];
  readonly lights: LampLight[] = [];
  readonly markers: Marker[] = [];
  readonly movers: Mover[] = [];
  readonly roads: Road[] = [];
  private readonly extents = new Map<string, Extent>();
  private readonly buckets = new Map<number, Rect[]>();
  private clearOfRoads: (r: Rect) => boolean;
  private draws = 0;
  readonly map: CoastMap;
  readonly seed: number;
  private readonly planRoads: readonly Road[];

  constructor(map: CoastMap, seed: number, props: readonly PropMesh[], planRoads: readonly Road[]) {
    this.map = map;
    this.seed = seed;
    this.planRoads = planRoads;
    for (const prop of props) this.extents.set(prop.id, extentOf(prop));
    this.clearOfRoads = roadIndex(planRoads);
  }

  /** The next number of the ledger's own seeded sequence, in [0, 1). */
  random(): number {
    return hash01(this.seed, this.draws++);
  }

  /** Adds a local road: later props keep clear of it too. */
  addRoad(road: Road) {
    this.roads.push(road);
    this.clearOfRoads = roadIndex([...this.planRoads, ...this.roads]);
  }

  extent(prop: string): Extent {
    const extent = this.extents.get(prop);
    if (!extent) throw new Error(`coast: unknown prop ${prop}`);
    return extent;
  }

  private cells(r: Rect, visit: (key: number) => void) {
    const reach = Math.hypot(r.hx, r.hz);
    for (let i = Math.floor((r.x - reach) / CELL); i <= Math.floor((r.x + reach) / CELL); i++)
      for (let k = Math.floor((r.z - reach) / CELL); k <= Math.floor((r.z + reach) / CELL); k++)
        visit(i * 1_000_003 + k);
  }

  /** Whether `r` is inside the region, clear of roads (unless `onRoad`) and of every footprint. */
  free(r: Rect, onRoad = false): boolean {
    const b: Bounds = this.map.bounds;
    if (corners(r).some(([x, z]) => x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ))
      return false;
    const owner = this.map.plan.biome(r.x, r.z).owner;
    if (owner !== 'coast' && owner !== 'sea') return false;
    let hit = false;
    this.cells(r, (key) => {
      if (!hit) hit = (this.buckets.get(key) ?? []).some((other) => overlaps(r, other));
    });
    return !hit && (onRoad || this.clearOfRoads(r));
  }

  /** Ground heights under the rectangle: its corners and centre. */
  ground(r: Rect): number[] {
    return [...corners(r), [r.x, r.z] as [number, number]].map(([x, z]) => this.map.height(x, z));
  }

  /** Places `prop` at (x, z) facing `yaw`, or returns undefined when the rules refuse it. */
  place(prop: string, x: number, z: number, yaw: number, options: PlaceOptions = {}) {
    const r = rectOf(this.extent(prop), x, z, yaw, options.scale);
    if (!this.free(r, options.onRoad)) return undefined;
    const seat = seatOf(prop),
      heights = this.ground(r),
      low = Math.min(...heights),
      high = Math.max(...heights);
    let y: number;
    if (seat === 'ground') {
      if ((!options.wet && low <= 0.2) || high - low > (options.maxRise ?? 1)) return undefined;
      y = low;
    } else if (seat === 'water') {
      if (high >= -0.5) return undefined;
      y = 0;
    } else {
      y = options.y ?? 0;
      if (seat === 'deck' && this.map.height(x, z) >= y) return undefined;
    }
    const instance: Instance = {
      prop,
      position: [x, y, z],
      yaw,
      ...(options.scale !== undefined ? { scale: options.scale } : {}),
      ...(options.name ? { name: options.name } : {}),
    };
    this.instances.push(instance);
    this.cells(r, (key) => {
      const list = this.buckets.get(key);
      if (list) list.push(r);
      else this.buckets.set(key, [r]);
    });
    const lamps = PROP_LAMPS[prop];
    if (lamps)
      this.lights.push(
        ...placeLamps(lamps, instance, options.name ?? `coast/${prop}-${this.instances.length}`),
      );
    return instance;
  }
}

/** A yaw that turns local +Z toward the ground direction (dx, dz). */
export const yawToward = (dx: number, dz: number) => Math.atan2(dx, dz);
