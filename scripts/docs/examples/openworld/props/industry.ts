/**
 * Energy structures at real size: a 40 m lattice power pylon (conductors run along X) and a
 * wind turbine — its tower and nacelle, and its rotor as a separate prop the page spins.
 */
import type { MeshPart, PropMesh, Vec3 } from '../plan/contract.ts';
import { lathe, loft, type ProfilePoint } from './round.ts';
import { roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop, transform } from './transform.ts';
import { truss } from './truss.ts';

const { steel, whitePaint, glass } = SURFACES;

/** A string of `discs` glass insulator discs hanging from y = 0 down to −length. */
function insulator(discs: number, length: number): MeshPart {
  const pitch = length / discs,
    profile: ProfilePoint[] = [[0.03, -length]];
  for (let k = discs - 1; k >= 0; k--) {
    const y = -k * pitch - pitch;
    profile.push([0.04, y + pitch * 0.1], [0.14, y + pitch * 0.45], [0.05, y + pitch * 0.7]);
  }
  profile.push([0.03, 0]);
  return lathe(glass, profile, { segments: 12 });
}

/** A 40 m high-voltage pylon: tapered lattice body, two lattice cross-arms, six insulators. */
export function powerPylon(): PropMesh {
  const body = truss(steel, [0, 0, 0], [0, 40, 0], {
      width: [7, 1.4],
      bays: 18,
      chord: 0.12,
      brace: 0.05,
    }),
    arms = [30, 36].flatMap((y) => {
      const reach = y === 30 ? 8 : 6;
      return [
        truss(steel, [-reach, y, 0], [reach, y, 0], {
          width: [0.6, 0.6],
          bays: 12,
          chord: 0.06,
          brace: 0.03,
          sides: 5,
        }),
        ...[-1, 0, 1].map((k) =>
          transform(insulator(8, 2.4), { at: [k * (reach - 0.4) + (k ? 0 : 1.2), y - 0.3, 0] }),
        ),
      ];
    });
  return prop('power-pylon', [body, ...arms]);
}

/** Hub height of the wind turbine, and where the rotor's origin sits on the tower prop. */
export const WIND_TURBINE = { hubHeight: 80, rotorAnchor: [0, 80, 3.6] as Vec3, rotorRadius: 40 };

/** The turbine's tapered tower and its nacelle; the rotor is `windTurbineRotor`, facing +Z. */
export function windTurbineTower(): PropMesh {
  const profile = Array.from({ length: 24 }, (_, i): ProfilePoint => {
    const y = (78 * i) / 23;
    return [2.3 - 1.0 * (y / 78) + (i === 0 ? 0.3 : 0), y];
  });
  return prop('wind-turbine-tower', [
    lathe(whitePaint, profile, { segments: 48 }),
    transform(roundedBox(whitePaint, [3.4, 3.6, 10], 0.9, 4), { at: [0, 78.2, 0.2] }),
  ]);
}

/** One 40 m blade along +Y, chord in the rotor plane, twisted toward the tip. */
function blade(): MeshPart {
  const stations = 40,
    around = 20,
    rings = Array.from({ length: stations + 1 }, (_, s) => {
      const t = s / stations,
        r = 1.6 + 38.4 * t,
        chord = t < 0.12 ? 1.8 + 12 * t : 3.3 * (1 - t) + 0.5,
        twist = 0.3 * (1 - t);
      return Array.from({ length: around }, (_, k): Vec3 => {
        const a = (2 * Math.PI * k) / around,
          x = 0.5 * chord * Math.cos(a) - 0.2 * chord,
          z = 0.09 * chord * Math.sin(a) * (1.3 - 0.5 * Math.cos(a));
        return [
          x * Math.cos(twist) - z * Math.sin(twist),
          r,
          x * Math.sin(twist) + z * Math.cos(twist),
        ];
      });
    });
  return loft(whitePaint, rings, { caps: true });
}

/**
 * The rotor: spinner and three blades in the XY plane, origin at the hub centre, spinning about
 * its local +Z. Place it at `WIND_TURBINE.rotorAnchor` in the tower's frame.
 */
export function windTurbineRotor(): PropMesh {
  const spinner = Array.from({ length: 12 }, (_, i): ProfilePoint => {
    const a = (Math.PI / 2) * (i / 11);
    return [1.7 * Math.cos(a), -1.2 + 3.4 * Math.sin(a)];
  });
  return prop('wind-turbine-rotor', [
    transform(lathe(whitePaint, spinner, { segments: 32 }), { pitch: Math.PI / 2 }),
    ...[0, 1, 2].map((i) => transform(blade(), { roll: (i * 2 * Math.PI) / 3 })),
  ]);
}
