/**
 * The plan's mountain settlements, built: in each, the church first near the centre, then
 * chalets on a golden-angle spiral, every gable turned to the valley (downhill); the ski resort
 * adds two hotels and more chalets. Lantern posts line the roads through each, a car waits at
 * the roadside nearest the centre, and each settlement is a teleport facing its church.
 */
import type { LampLight, Marker, Settlement } from '../../plan/contract.ts';
import { placeLamps } from '../../props/index.ts';
import { BASEMENT } from './chalet.ts';
import { CHURCH_LAMPS } from './church.ts';
import { LANTERN_LAMPS } from './nature.ts';
import { CHALETS } from './props.ts';
import type { Placer } from './space.ts';
import { steep } from './surfaces.ts';
import { downhill } from './terrain.ts';
import { EYE } from '../../build/markers.ts';
import { beside, headingYaw, onGround, resample } from './route.ts';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Chalets a settlement of each kind holds; the resort's first two buildings are hotels. */
const HOUSES = { resort: 60, town: 60, village: 24 } as const;
const HOTEL = CHALETS.find((spec) => spec.id === 'mountains/hotel')!;
const HOMES = CHALETS.filter((spec) => spec.id.startsWith('mountains/chalet-'));

/** The yaw that turns a building's +Z front down the slope. */
const valleyYaw = (placer: Placer, x: number, z: number) => {
  const { dir } = downhill(placer.plan.height, x, z);
  return headingYaw(dir[0], dir[1]);
};

/** The plan's settlements inside the mountains, the resort first. */
export const mountainSettlements = (placer: Placer): Settlement[] =>
  placer.plan.settlements
    .filter((s) => s.region === 'mountains' && placer.owns(s.centre[0], s.centre[2]))
    .sort((a, b) => Number(b.kind === 'resort') - Number(a.kind === 'resort'));

export type Village = { lights: LampLight[]; markers: Marker[] };

export function placeVillage(placer: Placer, site: Settlement, rand: () => number): Village {
  const [cx, , cz] = site.centre,
    lights: LampLight[] = [],
    markers: Marker[] = [],
    tag = `mountains/${site.id}`,
    houses = site.kind in HOUSES ? HOUSES[site.kind as keyof typeof HOUSES] : 0;
  for (let k = 0; k < 300; k++) {
    const r = 10 + k * 3,
      [x, z] = [cx + Math.cos(k * GOLDEN) * r, cz + Math.sin(k * GOLDEN) * r],
      yaw = valleyYaw(placer, x, z),
      church = placer.place('mountains/church', x, z, {
        seat: 'high',
        basement: BASEMENT,
        yaw,
        name: `${tag}/church`,
      });
    if (!church) continue;
    lights.push(...placeLamps(CHURCH_LAMPS, church));
    const [tx, tz] = [x + Math.sin(yaw) * 45, z + Math.cos(yaw) * 45];
    markers.push({
      kind: 'teleport',
      name: tag,
      position: [tx, placer.plan.height(tx, tz) + EYE, tz],
      yaw: yaw + Math.PI,
      pitch: 0.12,
    });
    break;
  }
  let built = 0;
  for (let k = 0; k < 900 && built < houses; k++) {
    const r = 45 + Math.sqrt(k) * 13;
    if (r > site.radius) break;
    const [x, z] = [cx + Math.cos(k * GOLDEN + 1) * r, cz + Math.sin(k * GOLDEN + 1) * r],
      spec = site.kind === 'resort' && built < 2 ? HOTEL : HOMES[Math.floor(rand() * HOMES.length)],
      yaw = valleyYaw(placer, x, z) + (rand() - 0.5) * 0.3;
    const placed = placer.place(spec.id, x, z, {
      seat: 'high',
      basement: BASEMENT,
      yaw,
      maxSlope: steep(25),
      name: `${tag}/house-${built}`,
    });
    if (placed) built++;
  }
  for (const road of placer.plan.roads)
    for (const [i, s] of resample(road, 32).entries()) {
      if (Math.hypot(s.at[0] - cx, s.at[2] - cz) > site.radius) continue;
      const [x, z] = beside(s, road.width / 2 + 1.2, i % 2 ? 1 : -1),
        placed = placer.place('mountains/lantern-post', x, z, {
          name: `${tag}/${road.id}/lantern-${i}`,
        });
      if (placed) lights.push(...placeLamps(LANTERN_LAMPS, placed));
    }
  const near = placer.plan.roads
    .filter((road) => road.class !== 'dirt')
    .flatMap((road) => resample(road, 20))
    .filter((s) => placer.owns(s.at[0], s.at[2], 10) && onGround(placer.plan, s.at))
    .sort(
      (a, b) => Math.hypot(a.at[0] - cx, a.at[2] - cz) - Math.hypot(b.at[0] - cx, b.at[2] - cz),
    )[0];
  if (near && Math.hypot(near.at[0] - cx, near.at[2] - cz) < site.radius * 2)
    markers.push({
      kind: 'spawn',
      vehicle: 'car',
      name: `${tag}/car`,
      // On the ground the physics reads, which a sampled road centreline only approaches.
      position: [near.at[0], placer.plan.height(near.at[0], near.at[2]), near.at[2]],
      yaw: headingYaw(...near.dir),
    });
  return { lights, markers };
}
