/**
 * The desert's refinement of the global relief: tablelands stand on the plain, the canyon cuts
 * through its plateau, dunes cover what the rock leaves free. The plan fades the result into the
 * neighbours by its biome weights; nothing here knows where the region's border is.
 */
import { duneHeight } from './dunes.ts';
import { smoothstep } from './field.ts';
import {
  canyonCarve,
  rimRadius,
  slopes,
  tablelandProfile,
  tablelandsNear,
  type Tableland,
} from './landforms.ts';

/** Metres outside the rim of `t` at (x, z); negative inside. */
function outsideRim(t: Tableland, x: number, z: number): number {
  return Math.hypot(x - t.x, z - t.z) - rimRadius(t, Math.atan2(z - t.z, x - t.x));
}

/** What the rock adds at (x, z), and how much of the ground it owns (1 = no dunes). */
export function rockAt(x: number, z: number): { height: number; owned: number } {
  // Rock stacks by its highest part; the wadi's wash may cut below the plain.
  let top = 0,
    cut = 0,
    owned = 0;
  for (const t of tablelandsNear(x, z)) {
    const { cliffRun, talusRun } = slopes(t.height),
      // A plateau's wadi runs on past its talus, as far as its canyon's reach.
      reach = t.kind === 'plateau' ? t.radius * 2.3 : t.radius * 1.2 + cliffRun + talusRun;
    if (Math.abs(x - t.x) > reach || Math.abs(z - t.z) > reach) continue;
    const e = outsideRim(t, x, z);
    let h = tablelandProfile(e, t.height);
    if (t.kind === 'plateau') h -= canyonCarve(t, x, z, h);
    if (h >= 0) top = Math.max(top, h);
    else cut = Math.min(cut, h);
    owned = Math.max(owned, 1 - smoothstep(cliffRun + 0.5 * talusRun, cliffRun + talusRun, e));
  }
  return { height: top > 0 ? top : cut, owned };
}

/** What the desert adds to the global relief at (x, z); the plan fades it at the borders. */
export function refineDesert(x: number, z: number): number {
  const rock = rockAt(x, z);
  return rock.height + (rock.owned < 1 ? (1 - rock.owned) * duneHeight(x, z) : 0);
}
