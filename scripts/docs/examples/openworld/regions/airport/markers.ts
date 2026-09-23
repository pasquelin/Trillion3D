/**
 * Where the player arrives and what the page animates around the field: teleports (the terminal,
 * the tower's roof — the region's viewpoint over both runways — and the runway threshold),
 * the player's plane on the threshold, a car in the car park, jet exhaust where airliners spool
 * up and dust where they touch down.
 */
import type { Instance, Marker, Vec3 } from '../../plan/contract.ts';
import type { Context } from './context.ts';
import { CAR_PARK } from './landside.ts';
import { air, landing } from './motion.ts';
import { FIELD } from './site.ts';
import { BAY } from './terminal.ts';
import { TOWER_CAB_FLOOR } from './tower.ts';
import { EYE } from '../../build/markers.ts';

/** The placed node named `name`; the layout always places it, so its absence is a bug. */
export function node(ctx: Context, name: string): Instance {
  const found = ctx.placer.placed.find((p) => p.instance.name === name);
  if (!found) throw new Error(`airport: ${name} was not placed`);
  return found.instance;
}

const lift = ([x, y, z]: Vec3, h: number): Vec3 => [x, y + h, z];

export function markers(ctx: Context): Marker[] {
  const d = landing(ctx),
    [r1, r2] = FIELD.runways,
    half = ctx.site.length / 2,
    threshold = -d * half,
    hall = node(ctx, 'airport/terminal-hall').position,
    tower = node(ctx, 'airport/control-tower').position,
    [gx, gz] = ctx.site.world(0, FIELD.terminalFace + 6),
    [ts, tt] = ctx.site.local(tower[0], tower[2]),
    // Over the cab's airside glass, on the tower's roof: the apron and both runways below.
    [tx, tz] = ctx.site.world(ts, tt - 6);
  return [
    {
      kind: 'teleport',
      name: 'Airport — terminal',
      position: [gx, hall[1] + BAY.upper + EYE, gz],
      yaw: ctx.site.facing(0, -1),
    },
    {
      kind: 'teleport',
      name: 'Airport — control tower',
      position: [tx, tower[1] + TOWER_CAB_FLOOR + EYE, tz],
      deck: true,
      yaw: ctx.site.facing(0, -1),
      pitch: -0.18,
    },
    {
      kind: 'teleport',
      name: 'Airport — runway threshold',
      position: lift(air(ctx, threshold - d * 20, r1, 0), EYE),
      yaw: ctx.site.facing(d, 0),
    },
    {
      kind: 'spawn',
      vehicle: 'plane',
      name: 'Airport — runway 1',
      position: air(ctx, threshold + d * 60, r1, 0),
      yaw: ctx.site.facing(d, 0),
    },
    {
      kind: 'spawn',
      vehicle: 'car',
      name: 'Airport — car park',
      position: air(ctx, CAR_PARK.from + 20, CAR_PARK.near + 3.5, 0),
      yaw: ctx.site.facing(1, 0),
    },
    {
      kind: 'emitter',
      effect: 'jet-exhaust',
      name: 'airport/take-off-roll',
      position: air(ctx, threshold + d * 60, r1, 2),
      radius: 90,
    },
    {
      kind: 'emitter',
      effect: 'jet-exhaust',
      name: 'airport/apron',
      position: air(ctx, 0, -110, 2),
      radius: 260,
    },
    {
      kind: 'emitter',
      effect: 'runway-dust',
      name: 'airport/touchdown',
      position: air(ctx, threshold + d * 420, r1, 1),
      radius: 120,
    },
    {
      kind: 'emitter',
      effect: 'runway-dust',
      name: 'airport/runway-2',
      position: air(ctx, 0, r2, 1),
      radius: 200,
    },
  ];
}
