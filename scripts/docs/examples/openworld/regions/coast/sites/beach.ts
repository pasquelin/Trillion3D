/**
 * The beach resort, on the mainland's longest low shore away from the lighthouse: a promenade
 * (a local street) behind the sand with lamps, benches, changing huts and cafés, rows of
 * parasols down to the water, lifeguard towers, and a long pier with lamps out to a pier head.
 */
import type { Vec3 } from '../../../plan/contract.ts';
import { PIER } from '../props/pier.ts';
import { shoreFrame, type ShoreFrame } from './frame.ts';
import type { Layout } from './layout.ts';
import type { Shore } from './map.ts';
import { EYE } from '../../../build/markers.ts';

/** The resort's half-length along the coast, metres, and the promenade's width. */
const HALF = 420,
  PROMENADE = 8;
/** A beach is a shore cell this low; the promenade runs where the ground reaches `DRY`. */
const LOW = 4,
  DRY = 3.5;

export type Resort = { frame: ShoreFrame; pierHead?: Vec3; promenade: Vec3 };

function longestBeach(layout: Layout, avoid?: Vec3): Shore | undefined {
  const low = layout.map.shores.filter(
    (s) =>
      !s.island && s.height < LOW && (!avoid || Math.hypot(s.x - avoid[0], s.z - avoid[2]) > 2_000),
  );
  let best: Shore | undefined,
    score = 0;
  for (const s of low) {
    const near = low.reduce(
      (sum, o) => sum + (Math.abs(o.x - s.x) + Math.abs(o.z - s.z) < HALF ? 1 : 0),
      0,
    );
    if (near > score) [best, score] = [s, near];
  }
  return best;
}

/** The pier: bays out along the normal until the water is 5 m deep (or 30 bays), then the head. */
function pier(layout: Layout, f: ShoreFrame): Vec3 | undefined {
  let v = 12;
  for (let bay = 0; bay < 30; bay++) {
    const [x, z] = f.at(0, v - PIER.bay / 2),
      id = bay % 3 === 2 ? 'coast-pier-bay-lamps' : 'coast-pier-bay';
    if (!layout.place(id, x, z, f.seaward, { y: PIER.deck })) return undefined;
    v -= PIER.bay;
    if (bay >= 8 && layout.map.height(x, z) < -5) break;
  }
  const [x, z] = f.at(0, v - PIER.head / 2);
  return layout.place('coast-pier-head', x, z, f.seaward, { y: PIER.deck })
    ? [x, PIER.deck, z]
    : undefined;
}

/** The promenade line at the dry edge of the sand, with its furniture both sides. */
function promenade(layout: Layout, f: ShoreFrame): Vec3[] {
  const points: Vec3[] = [];
  for (let u = -HALF; u <= HALF; u += 20) {
    const v = f.inland(u, DRY);
    if (v === undefined) continue;
    const [x, z] = f.at(u, v + PROMENADE / 2 + 2);
    points.push([x, layout.map.height(x, z), z]);
  }
  if (points.length > 2)
    layout.addRoad({ id: 'coast/promenade', class: 'street', width: PROMENADE, points });
  return points;
}

/** Furniture at `offset` metres seaward of each promenade point (negative: inland). */
function along(
  layout: Layout,
  line: readonly Vec3[],
  f: ShoreFrame,
  offset: number,
  every: number,
  put: (x: number, z: number, i: number) => void,
) {
  for (let i = 0; i < line.length; i += every) {
    const [px, , pz] = line[i];
    put(px + f.normal[0] * offset, pz + f.normal[1] * offset, i);
  }
}

export function beachResort(layout: Layout, avoid?: Vec3): Resort | undefined {
  // Away from the lighthouse when the coast is long enough; on a short coast, its longest beach.
  const s = longestBeach(layout, avoid) ?? longestBeach(layout);
  if (!s) return undefined;
  const f = shoreFrame(layout.map, s),
    line = promenade(layout, f),
    pierHead = pier(layout, f),
    half = PROMENADE / 2;
  // Lamps' arms reach inland over the promenade's edge; benches between them face the sea.
  along(layout, line, f, half + 2.1, 2, (x, z) =>
    layout.place('street-lamp', x, z, Math.atan2(f.normal[1], -f.normal[0])),
  );
  along(layout, line, f, half + 1.2, 2, (x, z) =>
    layout.place('bench', x + f.tangent[0] * 10, z + f.tangent[1] * 10, f.seaward),
  );
  along(layout, line, f, -(half + 10.3), 7, (x, z, i) =>
    layout.place(i % 2 ? 'coast-cafe-red' : 'coast-cafe-blue', x, z, f.seaward, { maxRise: 1.2 }),
  );
  along(layout, line, f, half + 5, 4, (x, z, i) => {
    const colours = ['coast-hut-blue', 'coast-hut-red', 'coast-hut-yellow'];
    for (let k = 0; k < 6; k++)
      layout.place(
        colours[(i + k) % 3],
        x + f.tangent[0] * (k * 2.6 - 6),
        z + f.tangent[1] * (k * 2.6 - 6),
        f.seaward,
      );
  });
  const parasols = ['coast-parasol-red', 'coast-parasol-blue', 'coast-parasol-yellow'];
  for (let u = -HALF; u <= HALF; u += 9) {
    const dry = f.inland(u, DRY);
    if (dry === undefined) continue;
    for (let v = 18; v < dry - 6; v += 8) {
      const [x, z] = f.at(u + (layout.random() - 0.5) * 3, v);
      layout.place(
        parasols[Math.floor(layout.random() * 3)],
        x,
        z,
        f.seaward + (layout.random() - 0.5) * 0.4,
      );
    }
    if ((u + HALF) % 180 === 0)
      layout.place('coast-lifeguard-tower', ...f.at(u + 4, 10), f.seaward);
  }
  const middle = line[Math.floor(line.length / 2)] ?? f.origin,
    [gx, gz] = f.at(0, -120);
  layout.markers.push(
    {
      kind: 'teleport',
      name: 'coast/beach',
      position: [middle[0], middle[1] + EYE, middle[2]],
      yaw: f.seaward,
      pitch: -0.05,
    },
    {
      kind: 'emitter',
      effect: 'birds',
      name: 'coast/gulls-pier',
      position: [gx, 25, gz],
      radius: 250,
    },
  );
  if (pierHead) {
    const [x, z] = [pierHead[0] + f.tangent[0] * 30, pierHead[2] + f.tangent[1] * 30];
    layout.markers.push({
      kind: 'spawn',
      vehicle: 'boat',
      name: 'coast/pier-boat',
      position: [x, 0, z],
      yaw: f.seaward,
    });
  }
  return { frame: f, pierHead, promenade: middle };
}
