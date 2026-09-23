/**
 * The plan's bridges inside the city's bounds, built of equal spans stretched to the bridge's
 * length and to its road's width plus two walkways; a pier under every other joint where the
 * valley falls away, and a lamp on each walkway every 30 m.
 */
import { STREET_LAMP_LIGHTS } from '../../props/index.ts';
import { SPAN } from './bridge-props.ts';
import { sidewaysOf, turn, xz, type Xz } from './frame.ts';
import { RANK, type Placer } from './placement.ts';
import { inBounds } from './site.ts';

/** How deep the pier column reaches under the girders' soffit. */
const PIER_REACH = 30;

export function layBridges(placer: Placer) {
  const { plan } = placer.site;
  for (const bridge of plan.bridges) {
    const from = xz(bridge.from),
      to = xz(bridge.to);
    if (!inBounds(placer.site, from) || !inBounds(placer.site, to)) continue;
    const dx = to[0] - from[0],
      dz = to[1] - from[1],
      length = Math.hypot(dx, dz),
      spans = Math.max(1, Math.round(length / SPAN.length)),
      yaw = sidewaysOf([dx, dz]),
      stretch = length / (spans * SPAN.length),
      widen = bridge.width / SPAN.width,
      point = (t: number) =>
        [
          from[0] + dx * t,
          bridge.from[1] + (bridge.to[1] - bridge.from[1]) * t,
          from[1] + dz * t,
        ] as const;
    for (let s = 0; s < spans; s++) {
      const t = (s + 0.5) / spans,
        [x, y, z] = point(t);
      placer.place(
        'city/bridge-span',
        [x, y, z],
        yaw,
        'road',
        RANK.structure,
        {
          centre: [x, z],
          half: [(SPAN.length * stretch) / 2, (SPAN.width / 2 + SPAN.walkway) * widen],
          yaw,
        },
        { scale: [stretch, 1, widen] },
      );
      const joint = s / spans,
        [px, py, pz] = point(joint),
        soffit = py - 0.6 - SPAN.depth;
      if (
        s > 0 &&
        s % 2 === 0 &&
        plan.height(px, pz) < soffit - 3 &&
        plan.height(px, pz) > soffit - PIER_REACH
      )
        placer.place('city/bridge-pier', [px, soffit, pz], yaw, 'road', RANK.structure, undefined, {
          support: soffit - PIER_REACH,
          scale: [1, 1, widen],
        });
    }
    // Lamps stand on the walkways, their arms over the carriageway.
    const count = Math.floor(length / 30);
    for (let k = 1; k <= count; k++)
      for (const sign of [-1, 1]) {
        const [x, y, z] = point(k / (count + 1)),
          [ox, oz] = turn([0, sign * (bridge.width / 2 + 1)], yaw),
          toRoad: Xz = turn([0, -sign], yaw);
        placer.place(
          'street-lamp',
          [x + ox, y + 0.2, z + oz],
          sidewaysOf(toRoad),
          'solid',
          RANK.street,
          undefined,
          {
            lamps: STREET_LAMP_LIGHTS,
          },
        );
      }
  }
}
