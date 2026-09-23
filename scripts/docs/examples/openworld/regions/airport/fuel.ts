/**
 * The fuel farm: a 30 m jet-fuel tank (stiffening rings, a domed roof with a railed walkway,
 * a stair winding up its shell, foam pourers) standing in its own bund, and a pipe rack that
 * carries the hydrant lines from the farm toward the apron.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import { box, cylinder, lathe, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT } from './palette.ts';
import { member } from './parts.ts';

export const TANK = { radius: 15, height: 16, bund: 22, segments: 96 } as const;
const { steel, concrete } = SURFACES;

/** A stair winding a quarter-and-a-half turn up the shell, treads every 0.25 m of rise. */
function stair(): MeshPart[] {
  const r = TANK.radius + 0.9,
    steps = Math.round(TANK.height / 0.25),
    turn = (1.5 * Math.PI) / 2;
  const at = (i: number, dr = 0): Vec3 => {
    const a = (turn * i) / steps;
    return [(r + dr) * Math.cos(a), (TANK.height * i) / steps, (r + dr) * Math.sin(a)];
  };
  const treads = Array.from({ length: steps }, (_, i) => {
    const [x, y, z] = at(i);
    return transform(box(steel, [1.1, 0.05, 0.3]), { at: [x, y, z], yaw: -((turn * i) / steps) });
  });
  const rail = Array.from({ length: steps + 1 }, (_, i) => {
    const [x, y, z] = at(i, 0.55);
    return [x, y + 1, z] as Vec3;
  });
  return [...treads, tube(steel, rail, 0.03, { segments: 5 })];
}

function tank(): PropMesh {
  const { radius: r, height: h, segments } = TANK;
  const rings = [2, 4, 6, 8, 10, 12, 14].map((y) =>
    transform(cylinder(steel, r + 0.12, 0.25, { segments }), { at: [0, y, 0] }),
  );
  const railing = Array.from({ length: 25 }, (_, i): Vec3 => {
    const a = (2 * Math.PI * i) / 24;
    return [(r - 0.3) * Math.cos(a), h + 1.1, (r - 0.3) * Math.sin(a)];
  });
  return prop('airport/fuel-tank', [
    transform(cylinder(concrete, r + 0.6, 0.8, { segments, caps: true }), { at: [0, -0.6, 0] }),
    cylinder(AIRPORT.tankWhite, r, h, { segments }),
    lathe(
      AIRPORT.tankWhite,
      [
        [r, h],
        [r * 0.7, h + 1.3],
        [r * 0.3, h + 2],
        [0, h + 2.1],
      ],
      { segments },
    ),
    ...rings,
    tube(steel, railing, 0.04, { segments: 5 }),
    ...stair(),
    ...[0, 1, 2, 3].map((i) =>
      transform(cylinder(AIRPORT.safetyOrange, 0.25, 1.2, { segments: 10, caps: true }), {
        at: [(r + 0.3) * Math.cos(i * 1.6 + 0.8), h - 1.2, (r + 0.3) * Math.sin(i * 1.6 + 0.8)],
      }),
    ),
    // The bund: a low wall holding a spill, 22 m out from the tank's centre.
    ...[-1, 1].flatMap((side) => [
      transform(box(concrete, [TANK.bund * 2, 1.4, 0.4]), { at: [0, -0.4, side * TANK.bund] }),
      transform(box(concrete, [0.4, 1.4, TANK.bund * 2]), { at: [side * TANK.bund, -0.4, 0] }),
    ]),
  ]);
}

/** 30 m of pipe rack along Z: portal frames every 6 m, four lines, one lagged. */
function pipeRack(): PropMesh {
  const frames = [-12, -6, 0, 6, 12].flatMap((z) => [
    member(steel, [-1.5, -0.3, z], [-1.5, 4, z], [0.25, 0.25]),
    member(steel, [1.5, -0.3, z], [1.5, 4, z], [0.25, 0.25]),
    transform(box(steel, [3.4, 0.25, 0.25]), { at: [0, 4, z] }),
    transform(box(steel, [3.4, 0.2, 0.2]), { at: [0, 2.6, z] }),
  ]);
  const line = (x: number, y: number, radius: number, surface = steel) =>
    tube(
      surface,
      [
        [x, y, -15],
        [x, y, 15],
      ],
      radius,
      { segments: 12 },
    );
  return prop('airport/pipe-rack', [
    ...frames,
    line(-1, 4.5, 0.25),
    line(-0.2, 4.45, 0.2),
    line(0.8, 4.55, 0.3, AIRPORT.tankWhite),
    line(-0.6, 3.05, 0.2, AIRPORT.tugYellow),
  ]);
}

export const fuelProps = (): PropMesh[] => [tank(), pipeRack()];
