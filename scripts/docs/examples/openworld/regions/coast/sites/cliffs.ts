/**
 * The chalk coast: every shore cell standing high above the sea gets a layered chalk face,
 * stretched to the cliff's own height and set into its slope; sea stacks stand off the longer
 * cliffs; fallen boulders lie in the surf; spray rises where the sea meets the chalk.
 */
import { CLIFF_FACES, SEA_STACKS } from '../props/index.ts';
import { FACE } from '../props/cliff.ts';
import type { Layout } from './layout.ts';
import { yawToward } from './layout.ts';
import { waterline, type Shore } from './map.ts';

/** A shore cell this high stands on a cliff: 12 m within one 50 m cell is steeper than 1 in 4. */
export const CLIFF_MIN = 12;

/** One spray emitter per this many faces, one stack per this many. */
const SPRAY_EVERY = 10,
  STACK_EVERY = 14;

/** The cliff's top behind a shore cell: the highest ground within 120 m inland. */
function cliffTop(layout: Layout, s: Shore): number {
  let top = s.height;
  for (let d = 10; d <= 120; d += 10)
    top = Math.max(top, layout.map.height(s.x - s.normal[0] * d, s.z - s.normal[1] * d));
  return top;
}

/** How far inland of the waterline the face stands: where the slope reaches a third of the top. */
function setBack(layout: Layout, w: readonly number[], n: readonly [number, number], top: number) {
  for (let d = 0; d <= 60; d += 2)
    if (layout.map.height(w[0] - n[0] * d, w[2] - n[1] * d) >= top / 3) return d;
  return 0;
}

export function dressCliffs(layout: Layout): Shore[] {
  const cliffs = layout.map.shores.filter((s) => s.height >= CLIFF_MIN),
    dressed: Shore[] = [];
  for (const s of cliffs) {
    const n = s.normal,
      w = waterline(layout.map, s.x, s.z, n),
      top = cliffTop(layout, s),
      back = setBack(layout, w, n, top),
      face = CLIFF_FACES[Math.floor(layout.random() * CLIFF_FACES.length)],
      stretch = Math.min(1.6, Math.max(0.4, (top + 1) / FACE.height));
    const placed = layout.place(
      face,
      w[0] - n[0] * back,
      w[2] - n[1] * back,
      yawToward(n[0], n[1]),
      {
        y: -1,
        scale: [1, stretch, 1],
      },
    );
    if (!placed) continue;
    dressed.push(s);
    if (dressed.length % SPRAY_EVERY === 1)
      layout.markers.push({
        kind: 'emitter',
        effect: 'sea-spray',
        name: `coast/spray-${dressed.length}`,
        position: [w[0], 2, w[2]],
        radius: 60,
      });
    if (dressed.length % STACK_EVERY === 0) {
      const out = 60 + layout.random() * 80,
        stack = SEA_STACKS[dressed.length % SEA_STACKS.length],
        [x, z] = [w[0] + n[0] * out, w[2] + n[1] * out];
      const depth = layout.map.height(x, z);
      if (depth < -1 && depth > -15)
        layout.place(stack, x, z, layout.random() * Math.PI * 2, { y: depth });
    }
  }
  return dressed;
}

/** Boulders in the surf off a shore: `count` tries, 5 to 45 m out, 2 to 7 m across. */
export function surfRocks(layout: Layout, shores: readonly Shore[], count: number) {
  const ids = ['rock-boulder', 'rock-slab', 'rock-spire'];
  for (let i = 0; i < count && shores.length; i++) {
    const s = shores[Math.floor(layout.random() * shores.length)],
      w = waterline(layout.map, s.x, s.z, s.normal),
      out = 5 + layout.random() * 40,
      side = (layout.random() - 0.5) * 40;
    layout.place(
      ids[Math.floor(layout.random() * ids.length)],
      w[0] + s.normal[0] * out - s.normal[1] * side,
      w[2] + s.normal[1] * out + s.normal[0] * side,
      layout.random() * Math.PI * 2,
      { scale: 2 + layout.random() * 5, wet: true, maxRise: 3 },
    );
  }
}
