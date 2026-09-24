/**
 * A bridge's deck, for the region that models it (#332): the road's own centreline between the
 * bridge's two ends, surface heights included, so a deck built on it meets the road at both
 * abutments and never steps. The ground under the span is left to the river.
 */
import type { Bridge, Vec3, WorldPlan } from './contract.ts';

const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * The road's centreline over a span, from `span.from` to `span.to` inclusive: a bridge's deck,
 * or a tunnel's bore (`plan.tunnels`, same shape).
 */
export function bridgeDeck(
  plan: Pick<WorldPlan, 'roads'>,
  bridge: Pick<Bridge, 'id' | 'road' | 'from' | 'to'>,
): Vec3[] {
  const road = plan.roads.find((candidate) => candidate.id === bridge.road);
  if (!road) throw new Error(`Bridge ${bridge.id} names no road of the plan`);
  const first = road.points.findIndex((p) => same(p, bridge.from)),
    last = road.points.findIndex((p, k) => k > first && same(p, bridge.to));
  if (first < 0 || last < 0) throw new Error(`Bridge ${bridge.id} does not lie on ${road.id}`);
  return road.points.slice(first, last + 1);
}
