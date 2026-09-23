/**
 * What every part of the layout shares while it places: the plan, the airport's frame, the
 * collision-aware placer, the region's seed and the lamps gathered so far.
 */
import type { LampLight, WorldPlan } from '../../plan/contract.ts';
import { hash01, placeLamps, type PropLamp } from '../../props/index.ts';
import type { Footprint, Layer, PlaceOptions, Placer } from './placer.ts';
import type { Site } from './site.ts';

export type Context = {
  plan: WorldPlan;
  site: Site;
  placer: Placer;
  seed: number;
  lights: LampLight[];
};

/** A square footprint of half side `h` centred on the origin. */
export const square = (h: number): Footprint => [[0, 0, h, h]];

/**
 * Places `prop` at local (s, t), its +Z turned toward local direction `toward`; true if placed.
 * `lamps` become world lights once the node stands.
 */
export function put(
  ctx: Context,
  prop: string,
  [s, t]: readonly [number, number],
  toward: readonly [number, number],
  footprint: Footprint,
  layer: Layer,
  options: PlaceOptions & { lamps?: readonly PropLamp[] } = {},
): boolean {
  const placed = ctx.placer.place(
    prop,
    ctx.site.world(s, t),
    ctx.site.yaw(toward[0], toward[1]),
    footprint,
    layer,
    options,
  );
  if (placed && options.lamps) {
    const node = ctx.placer.placed[ctx.placer.placed.length - 1].instance;
    ctx.lights.push(
      ...placeLamps(options.lamps, node, options.name ?? `${prop}@${ctx.placer.placed.length}`),
    );
  }
  return placed;
}

/** A seeded choice in [0, 1) for the layout part `part` and its index keys. */
export const chance = (ctx: Context, part: number, a: number, b = 0) =>
  hash01(ctx.seed, part, a, b);

/** Local points from `from` to `to` every `step` metres, ends included when they fit. */
export function along(from: number, to: number, step: number): number[] {
  const n = Math.floor(Math.abs(to - from) / step + 1e-9),
    sign = Math.sign(to - from) || 1;
  return Array.from({ length: n + 1 }, (_, i) => from + sign * step * i);
}
