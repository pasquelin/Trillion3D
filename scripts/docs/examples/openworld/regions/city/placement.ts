/**
 * The city's ledger of placed things. Every node comes in as an `Item`: its instance, its ground
 * footprint and kind, the lamps, markers and movers it carries, and how far down its solid
 * support reaches. `fits` refuses a footprint outside the bounds, on a road, or on another of its
 * kind; `finish` keeps the node budget by dropping the least important, farthest items first.
 */
import type {
  Budget,
  Instance,
  LampLight,
  Marker,
  Mover,
  RegionOutput,
  Road,
} from '../../plan/contract.ts';
import { placeLamps, type PropLamp } from '../../props/index.ts';
import { corners, Occupancy, segmentBox, xz, type Obb } from './frame.ts';
import { CELL, inBounds, type Site } from './site.ts';

/**
 * `solid` things stand on the ground and never overlap one another; `flat` ones cover it (block
 * plinths, quays) and never overlap one another either; `road` ones lie on a road (crossings,
 * bridge decks) and are the only ones allowed there. Items mounted on another (roof, facade,
 * stacked containers) have no footprint.
 */
export type Kind = 'solid' | 'flat' | 'road';

/** Footprints that share an edge touch, they do not overlap: a centimetre of float slack. */
export const TOUCH = 0.01;

/** Least to most expendable when the node budget is short. */
export const RANK = { structure: 0, street: 1, furniture: 2, garden: 3 } as const;

export type Item = {
  instance: Instance;
  box?: Obb;
  kind: Kind;
  rank: number;
  /** Lowest y of the solid under the item's base (its foundation, or the plinth it stands on). */
  support?: number;
  lights: LampLight[];
  markers: Marker[];
  movers: Mover[];
};

export type Extras = {
  lamps?: readonly PropLamp[];
  markers?: Marker[];
  movers?: Mover[];
  support?: number;
  scale?: Instance['scale'];
};

export class Placer {
  readonly items: Item[] = [];
  readonly roads: Road[] = [];
  /** Markers and movers that belong to no node (spawns, viewpoints, boats). */
  readonly markers: Marker[] = [];
  readonly movers: Mover[] = [];
  private readonly solids = new Occupancy<Item>(CELL / 4);
  private readonly flats = new Occupancy<Item>(CELL);
  private readonly streets = new Occupancy<string>(CELL);
  private readonly counts = new Map<string, number>();

  readonly site: Site;
  constructor(site: Site) {
    this.site = site;
  }

  /** A local road; vehicle roads keep props off them like the plan's own. */
  addRoad(road: Road, vehicles: boolean) {
    this.roads.push(road);
    if (vehicles)
      for (let i = 0; i + 1 < road.points.length; i++)
        this.streets.add(
          segmentBox(xz(road.points[i]), xz(road.points[i + 1]), road.width / 2),
          road.id,
        );
  }

  /** Whether a footprint of `kind` may go there; edges may touch within `TOUCH`. */
  fits(box: Obb, kind: Kind): boolean {
    if (!corners(box).every((c) => inBounds(this.site, c))) return false;
    if (
      kind !== 'road' &&
      (this.site.roads.hits(box, TOUCH).length || this.streets.hits(box, TOUCH).length)
    )
      return false;
    if (kind === 'solid') return !this.solids.hits(box, TOUCH).length;
    if (kind === 'flat') return !this.flats.hits(box, TOUCH).length;
    return true;
  }

  /** Whether anything solid or flat already covers part of `box`. */
  occupied(box: Obb): boolean {
    return this.solids.hits(box, TOUCH).length > 0 || this.flats.hits(box, TOUCH).length > 0;
  }

  /** A unique node name under `city/`. */
  name(stem: string) {
    const n = this.counts.get(stem) ?? 0;
    this.counts.set(stem, n + 1);
    return `city/${stem}-${n}`;
  }

  /** Places `prop` when its footprint fits (or it has none); returns the item or nothing. */
  place(
    prop: string,
    at: Instance['position'],
    yaw: number,
    kind: Kind,
    rank: number,
    box?: Obb,
    extras: Extras = {},
  ) {
    if (box && !this.fits(box, kind)) return undefined;
    const instance: Instance = {
      prop,
      position: at,
      yaw,
      ...(extras.scale ? { scale: extras.scale } : {}),
      name: this.name(prop.replace(/^city\//, '')),
    };
    const item: Item = {
      instance,
      ...(box ? { box } : {}),
      kind,
      rank,
      ...(extras.support !== undefined ? { support: extras.support } : {}),
      lights: extras.lamps ? placeLamps(extras.lamps, instance) : [],
      markers: extras.markers ?? [],
      movers: extras.movers ?? [],
    };
    if (box && kind === 'solid') this.solids.add(box, item);
    if (box && kind === 'flat') this.flats.add(box, item);
    this.items.push(item);
    return item;
  }

  /** The region output within `budget` nodes (movers count as nodes), and the items kept. */
  finish(budget: Budget): { output: RegionOutput; kept: Item[] } {
    const movers = this.movers.length + this.items.reduce((n, item) => n + item.movers.length, 0);
    const [cx, , cz] = this.site.city.centre,
      far = (item: Item) =>
        Math.hypot(item.instance.position[0] - cx, item.instance.position[2] - cz);
    const order = this.items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => a.item.rank - b.item.rank || far(a.item) - far(b.item) || a.index - b.index);
    const keep = new Set(order.slice(0, Math.max(0, budget.nodes - movers)).map((o) => o.index)),
      kept = this.items.filter((_, i) => keep.has(i));
    return {
      output: {
        props: [],
        instances: kept.map((item) => item.instance),
        lights: kept.flatMap((item) => item.lights),
        markers: [...this.markers, ...kept.flatMap((item) => item.markers)],
        movers: [...this.movers, ...kept.flatMap((item) => item.movers)],
        roads: this.roads,
      },
      kept,
    };
  }
}
