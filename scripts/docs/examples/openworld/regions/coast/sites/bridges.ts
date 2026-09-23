/**
 * The plan's bridges inside the coast are data only; the coast builds them: stone bays set end
 * to end along each span, stretched to cover it exactly, widened to the road, each bay at the
 * deck height the span reaches there. A bridge carries its road, so it is the one prop allowed
 * on one.
 */
import type { Bridge } from '../../../plan/contract.ts';
import { BRIDGE } from '../props/bridge.ts';
import { yawToward, type Layout } from './layout.ts';

export function bridges(layout: Layout, spans: readonly Bridge[]) {
  for (const span of spans) {
    const [dx, dy, dz] = [0, 1, 2].map((k) => span.to[k] - span.from[k]),
      length = Math.hypot(dx, dz),
      bays = Math.max(1, Math.ceil(length / BRIDGE.bay)),
      scale: [number, number, number] = [
        (span.width + 1) / BRIDGE.width,
        1,
        length / (bays * BRIDGE.bay),
      ];
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays;
      layout.place(
        'coast-bridge-bay',
        span.from[0] + dx * t,
        span.from[2] + dz * t,
        yawToward(dx, dz),
        { y: span.from[1] + dy * t, scale, onRoad: true, name: `coast/${span.id}/${i}` },
      );
    }
  }
}
