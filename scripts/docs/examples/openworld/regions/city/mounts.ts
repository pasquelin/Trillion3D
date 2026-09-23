/**
 * Things mounted on a building rather than standing on the ground: rooftop equipment on a flat
 * roof, and neon blade signs on a shop front. They carry no footprint; their host has one.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { turn, type Xz } from './frame.ts';
import { RANK, type Placer } from './placement.ts';
import { NEON } from './signs.ts';

/** A point in a prop's frame (`at`, turned by `yaw`), `up` metres over it. */
export const onProp = (at: Vec3, yaw: number, [u, v]: Xz, up: number): Vec3 => {
  const [x, z] = turn([u, v], yaw);
  return [at[0] + x, at[1] + up, at[2] + z];
};

/**
 * Equipment on a flat roof of half extents `half`, `y` over the tower's base: tanks, condensers
 * and a mast, or the helipad and a mast. Returns the helipad deck when there is one.
 */
export function rooftop(
  placer: Placer,
  at: Vec3,
  yaw: number,
  roof: { y: number; half: Xz },
  helipad: boolean,
) {
  const [hx, hz] = roof.half,
    mount = (prop: string, uv: Xz) =>
      placer.place(prop, onProp(at, yaw, uv, roof.y), yaw, 'solid', RANK.furniture);
  mount('city/antenna-mast', [-hx + 2, 0]);
  if (helipad) {
    mount('city/helipad', [0, 0]);
    return onProp(at, yaw, [0, 0], roof.y + 5.45);
  }
  mount('city/water-tank', [-0.55 * hx, -0.45 * hz]);
  mount('city/water-tank', [-0.55 * hx, 0.45 * hz]);
  mount('city/ac-unit', [0, 0.6 * hz]);
  mount('city/ac-unit', [0.6 * hx, 0.6 * hz]);
  return undefined;
}

/** A blade sign on the shop front at `front` metres from the block's centre line, glowing at night. */
export function neon(
  placer: Placer,
  at: Vec3,
  yaw: number,
  front: number,
  draw: number,
  seed: number,
) {
  const [colour, glow] = NEON[Math.floor((draw / 0.6) * NEON.length)],
    u = (hash01(seed, Math.round(at[0]), Math.round(at[2])) - 0.5) * 24,
    centre = onProp(at, yaw, [u, front + 0.6], 7.4),
    [r, g, b] = glow.emissive!;
  placer.place(
    `city/neon-${colour}`,
    onProp(at, yaw, [u, front], 4.4),
    yaw,
    'solid',
    RANK.furniture,
    undefined,
    {
      markers: [
        {
          kind: 'emitter',
          effect: 'neon-glow',
          name: placer.name('neon-glow'),
          position: centre,
          radius: 4,
        },
      ],
      lamps: [
        {
          id: 'glow',
          type: 'point',
          offset: [0, 3, 1],
          color: [r, g, b],
          intensity: 120,
          range: 14,
          night: true,
        },
      ],
    },
  );
}
