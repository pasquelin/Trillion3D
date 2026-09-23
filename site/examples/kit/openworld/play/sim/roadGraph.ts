import { polyline, roadIndex, type Polyline, type RoadIndex } from '../roads.ts';
import type { Road } from '../types.ts';

/**
 * The drivable road network as a graph: each road's two ends link to the roads that pass
 * through the same place (an end, or any vertex of a road it joins at a T). Traffic reads it to
 * turn at junctions; a road end with no link is a dead end, where a car turns back.
 */
/** A road reached at a junction, at `at` metres along it (its vertex `vertex`). */
type Link = { road: number; at: number; vertex: number };

export type RoadGraph = {
  roads: readonly Road[];
  lines: readonly Polyline[];
  /** Links at each road's start (`[0]`) and end (`[1]`). */
  ends: readonly (readonly [Link[], Link[]])[];
  index: RoadIndex;
  /** Which graph road a road object is, for the index's answers. */
  number: ReadonlyMap<Road, number>;
};

const DRIVABLE = new Set(['highway', 'secondary', 'pass', 'avenue', 'street', 'dirt']);

/** Cruise speed by road class, m/s. */
export const CRUISE: Readonly<Record<string, number>> = {
  highway: 30,
  secondary: 22,
  pass: 13,
  avenue: 14,
  street: 10,
  dirt: 8,
};

export function roadGraph(all: readonly Road[], join = 8): RoadGraph {
  const roads = all.filter((road) => DRIVABLE.has(road.class) && road.points.length > 1);
  const lines = roads.map((road) => polyline(road.points));
  const cells = new Map<string, Link[]>();
  const cell = (x: number, z: number) => `${Math.floor(x / join)},${Math.floor(z / join)}`;
  roads.forEach((road, number) =>
    road.points.forEach((point, vertex) => {
      const key = cell(point[0], point[2]);
      const list = cells.get(key) ?? [];
      list.push({ road: number, at: lines[number].along[vertex], vertex });
      cells.set(key, list);
    }),
  );
  const linksAt = (self: number, x: number, z: number) => {
    const found: Link[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const link of cells.get(`${Math.floor(x / join) + dx},${Math.floor(z / join) + dz}`) ??
          []) {
          if (link.road === self) continue;
          const [px, , pz] = roads[link.road].points[link.vertex];
          if (Math.hypot(px - x, pz - z) <= join && !found.some((l) => l.road === link.road))
            found.push(link);
        }
    return found;
  };
  const ends = roads.map((road, number) => {
    const [first, last] = [road.points[0], road.points[road.points.length - 1]];
    return [linksAt(number, first[0], first[2]), linksAt(number, last[0], last[2])] as const;
  });
  return {
    roads,
    lines,
    ends,
    index: roadIndex(roads),
    number: new Map(roads.map((road, number) => [road, number])),
  };
}
