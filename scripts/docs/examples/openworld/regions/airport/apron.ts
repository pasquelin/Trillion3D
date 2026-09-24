/**
 * The terminal and its apron: the central hall between two wings of bays, contact gates with
 * jet bridges and nose-in airliners, remote stands served by stairs trucks and buses, ground
 * vehicles at work, service lanes, and floodlight masts along the apron's edge.
 */
import { chance, put, square, type Context } from './context.ts';
import { GSE_SIZE } from './gse.ts';
import { BRIDGE_FOOTPRINT, GATE } from './jetbridge.ts';
import { FLOOD_LIGHTS } from './light-props.ts';
import { FIELD } from './site.ts';
import { BAY } from './terminal.ts';
import { HALL } from './terminal-hall.ts';

/** Bays on each side of the hall, and the contact gates along the whole front. */
const WINGS = 6;
const GATES = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => k * 48);
/** The remote stands east of the terminal. */
const REMOTE = [330, 400, 470, 540, 610, 680];
export const APRON = {
  from: -290,
  to: 720,
  edge: FIELD.apronTaxiway + FIELD.taxiwayWidth / 2 + 0.5,
};
const TOWARD_TERMINAL: [number, number] = [0, 1];

const gse = (prop: string) => {
  const [hw, hd, z] = GSE_SIZE[prop];
  return [[0, z, hw, hd]] as const;
};

/** A vehicle placed in a parked airliner's frame: (x, z) and a yaw relative to the airliner. */
function beside(
  ctx: Context,
  prop: string,
  at: [number, number],
  x: number,
  z: number,
  turn: number,
) {
  const nose = ctx.site.yaw(...TOWARD_TERMINAL),
    [c, s] = [Math.cos(nose), Math.sin(nose)],
    [wx, wz] = ctx.site.world(...at),
    [px, pz] = [wx + x * c + z * s, wz - x * s + z * c];
  return ctx.placer.place(prop, [px, pz], nose + turn, gse(prop), 'solid');
}

function terminal(ctx: Context) {
  const centre = FIELD.terminalFace + BAY.depth / 2,
    airside: [number, number] = [0, -1];
  put(
    ctx,
    'airport/terminal-hall',
    [0, centre],
    airside,
    [[0, 0, HALL.width / 2, HALL.depth / 2 + 0.15]],
    'solid',
    {
      reach: BAY.plinth,
      name: 'airport/terminal-hall',
    },
  );
  for (let i = 0; i < WINGS; i++)
    for (const side of [-1, 1])
      put(
        ctx,
        'airport/terminal-bay',
        [side * (HALL.width / 2 + BAY.width * (i + 0.5)), centre],
        airside,
        [[0, -2.45, BAY.width / 2, 32.6]],
        'solid',
        { reach: BAY.plinth },
      );
}

function gates(ctx: Context) {
  const t = FIELD.terminalFace - 0.15 - GATE.face;
  GATES.forEach((s, i) => {
    put(ctx, 'airport/jet-bridge', [s, t], TOWARD_TERMINAL, BRIDGE_FOOTPRINT, 'solid', {
      name: `airport/gate-${i + 1}/bridge`,
    });
    put(ctx, 'airport/mark-stand', [s, t], TOWARD_TERMINAL, square(1), 'paint');
    if (chance(ctx, 1, i) < 0.15) return;
    put(ctx, 'vehicle-airliner', [s, t], TOWARD_TERMINAL, GATE.airliner, 'solid', {
      name: `airport/gate-${i + 1}/airliner`,
    });
    beside(ctx, 'airport/baggage-train', [s, t], -5.5, 15.2, 0);
    beside(ctx, 'airport/tug', [s, t], 9, -13, 0);
    if (chance(ctx, 2, i) < 0.5)
      beside(ctx, 'airport/fuel-bowser', [s, t], -12.2, -12.6, Math.PI / 2);
  });
}

function remoteStands(ctx: Context) {
  const t = -150;
  REMOTE.forEach((s, i) => {
    put(ctx, 'airport/mark-stand', [s, t], TOWARD_TERMINAL, square(1), 'paint');
    if (chance(ctx, 3, i) < 0.25) return;
    put(ctx, 'vehicle-airliner', [s, t], TOWARD_TERMINAL, GATE.airliner, 'solid');
    beside(ctx, 'airport/stairs-truck', [s, t], 5, 9.8, 0);
    beside(ctx, 'airport/stairs-truck', [s, t], 4.2, -14.5, Math.PI);
  });
}

/** The paved apron, the lane behind the stands, the masts along the taxiway's edge. */
export function apron(ctx: Context) {
  const depth = FIELD.terminalFace - APRON.edge,
    middle = (APRON.edge + FIELD.terminalFace) / 2;
  for (let s = APRON.from; s < APRON.to; s += 101)
    put(ctx, 'airport/slab-concrete', [s + 50.5, middle], [1, 0], [[0, 0, 0.5, 0.5]], 'pad', {
      scale: [depth, 1, 101],
    });
  terminal(ctx);
  gates(ctx);
  remoteStands(ctx);
  for (let s = APRON.from + 40; s < APRON.to; s += 60)
    put(ctx, 'airport/mark-lane', [s, -122], [1, 0], square(1), 'paint');
  for (let s = APRON.from + 20, i = 0; s < APRON.to; s += 130, i++)
    put(ctx, 'airport/flood-mast', [s, APRON.edge + 4], [0, 1], square(1.2), 'solid', {
      reach: 0.9,
      lamps: FLOOD_LIGHTS,
      name: `airport/flood-mast-${i + 1}`,
    });
  for (let k = 0; k < 4; k++) {
    const s = APRON.from + 30 + k * 16;
    put(ctx, 'vehicle-city-bus', [s, -115], [1, 0], [[0, 0, 1.3, 6.1]], 'solid');
    put(ctx, 'vehicle-van', [s + 520, -114], [1, 0], [[0, 0, 1.05, 2.75]], 'solid');
  }
}
