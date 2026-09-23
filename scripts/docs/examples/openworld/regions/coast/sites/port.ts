/**
 * Where people live: the fishing port on the island (the plan's `port` settlement of the coast,
 * or the largest island's gentlest shore), with a stone quay, lamps, houses in rows facing the
 * water and boats moored along the quay; and the coast's towns and villages, clusters of houses
 * facing their street.
 */
import type { Settlement, Vec3 } from '../../../plan/contract.ts';
import { HOUSES } from '../props/houses.ts';
import { PIER } from '../props/pier.ts';
import { shoreFrame, type ShoreFrame } from './frame.ts';
import { yawToward, type Layout } from './layout.ts';
import { EYE } from '../../../build/markers.ts';

/** Quay bays, and the height of the quay's walking surface above the sea. */
const BAYS = 9,
  QUAY_TOP = 1.8;

const houseAt = (layout: Layout, x: number, z: number, yaw: number) =>
  layout.place(HOUSES[Math.floor(layout.random() * HOUSES.length)].id, x, z, yaw, { maxRise: 1.2 });

/** The island shore of the port: nearest the plan's port in the region, else the largest island's lowest. */
function portShore(layout: Layout) {
  const { map } = layout,
    b = map.bounds,
    port = map.plan.settlements.find(
      ({ region, kind, centre: [x, , z] }) =>
        region === 'coast' &&
        kind === 'port' &&
        x >= b.minX &&
        x <= b.maxX &&
        z >= b.minZ &&
        z <= b.maxZ,
    ),
    islands = map.shores.filter((s) => s.island && s.height < 10);
  if (!islands.length) return undefined;
  if (port)
    return islands.reduce((a, b) =>
      Math.hypot(a.x - port.centre[0], a.z - port.centre[2]) <=
      Math.hypot(b.x - port.centre[0], b.z - port.centre[2])
        ? a
        : b,
    );
  const size = new Map<number, number>();
  for (const label of map.land) if (label > 1) size.set(label, (size.get(label) ?? 0) + 1);
  const largest = [...size].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return islands
    .filter((s) => map.land[s.cell] === largest)
    .sort((a, b) => a.height - b.height || a.cell - b.cell)[0];
}

export function islandPort(layout: Layout): ShoreFrame | undefined {
  const s = portShore(layout);
  if (!s) return undefined;
  const f = shoreFrame(layout.map, s, 150),
    back = PIER.quayDepth / 2 - 1.5;
  for (let j = 0; j < BAYS; j++) {
    const u = (j - (BAYS - 1) / 2) * PIER.quay;
    layout.place(j % 2 ? 'coast-quay-bay-lamp' : 'coast-quay-bay', ...f.at(u, back), f.seaward, {
      y: QUAY_TOP,
    });
    const boat =
      j % 3 === 0
        ? 'coast-rowing-boat'
        : j % 3 === 1
          ? 'coast-fishing-boat-blue'
          : 'coast-fishing-boat-red';
    layout.place(
      boat,
      ...f.at(u, back - PIER.quayDepth / 2 - 3.5),
      yawToward(f.tangent[0], f.tangent[1]),
    );
    layout.place('coast-buoy', ...f.at(u + 4, -35 - layout.random() * 20), 0);
  }
  for (let row = 0; row < 3; row++)
    for (let u = -(BAYS * PIER.quay) / 2 - 20; u <= (BAYS * PIER.quay) / 2 + 20; u += 13)
      houseAt(
        layout,
        ...f.at(u + (layout.random() - 0.5) * 2, PIER.quayDepth + 9 + row * 15),
        f.seaward,
      );
  const [qx, qz] = f.at(0, back),
    [sx, sz] = f.at(0, -40);
  layout.markers.push(
    {
      kind: 'teleport',
      name: 'coast/island-port',
      position: [qx, QUAY_TOP + EYE, qz],
      deck: true,
      yaw: f.seaward,
      pitch: -0.1,
    },
    {
      kind: 'spawn',
      vehicle: 'boat',
      name: 'coast/island-port-boat',
      position: [sx, 0, sz],
      yaw: f.seaward,
    },
    {
      kind: 'emitter',
      effect: 'birds',
      name: 'coast/gulls-port',
      position: [qx, 30, qz],
      radius: 150,
    },
  );
  return f;
}

/** The yaw that faces the nearest road within `reach` of (x, z), or undefined. */
function faceStreet(layout: Layout, x: number, z: number, reach: number): number | undefined {
  let best: Vec3 | undefined,
    distance = reach;
  for (const road of [...layout.map.plan.roads, ...layout.roads])
    for (const p of road.points) {
      const d = Math.hypot(p[0] - x, p[2] - z);
      if (d < distance) [best, distance] = [p, d];
    }
  return best && yawToward(best[0] - x, best[2] - z);
}

/** A settlement's houses on a jittered 26 m grid within its radius, each facing its street. */
export function village(layout: Layout, settlement: Settlement) {
  const [cx, , cz] = settlement.centre,
    r = settlement.radius * 0.8;
  for (let z = cz - r; z <= cz + r; z += 26)
    for (let x = cx - r; x <= cx + r; x += 26) {
      if (Math.hypot(x - cx, z - cz) > r || layout.random() < 0.3) continue;
      const [hx, hz] = [x + (layout.random() - 0.5) * 8, z + (layout.random() - 0.5) * 8],
        yaw = faceStreet(layout, hx, hz, 80) ?? layout.random() * Math.PI * 2;
      houseAt(layout, hx, hz, yaw);
    }
}
