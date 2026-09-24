/**
 * The airport's own roads: two runways, the parallel and apron taxiways, the connectors that
 * cross them, the terminal's curbside and the access road that joins the plan's network. A
 * runway extends 60 m past each threshold (the blast pad the end connectors enter).
 */
import type { Road, Vec3, WorldPlan } from '../../plan/contract.ts';
import { FIELD, type Site } from './site.ts';

/** A road through local (s, t) points, resampled every `step` metres on the plan's ground. */
function road(
  plan: WorldPlan,
  site: Site,
  id: string,
  kind: Road['class'],
  width: number,
  local: readonly (readonly [number, number])[],
  step = 100,
): Road {
  const points: Vec3[] = [];
  for (let i = 0; i + 1 < local.length; i++) {
    const [a, b] = [local[i], local[i + 1]],
      n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const [x, z] = site.world(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
      points.push([x, plan.height(x, z), z]);
    }
  }
  return { id: `airport/${id}`, class: kind, width, points };
}

/** The end connectors' `s`: 30 m before each threshold, inside the blast pad. */
export const connectorS = (site: Site) => [-(site.length / 2 + 30), 0, site.length / 2 + 30];

export function airportRoads(plan: WorldPlan, site: Site): Road[] {
  const end = site.length / 2 + 60,
    [r1, r2] = FIELD.runways,
    { runwayWidth: rw, taxiwayWidth: tw } = FIELD,
    along = (t: number): [number, number][] => [
      [-(end - 30), t],
      [end - 30, t],
    ];
  const roads = [
    road(plan, site, 'runway-1', 'runway', rw, [
      [-end, r1],
      [end, r1],
    ]),
    road(plan, site, 'runway-2', 'runway', rw, [
      [-end, r2],
      [end, r2],
    ]),
    road(plan, site, 'taxiway-p', 'taxiway', tw, along(FIELD.parallelTaxiway)),
    road(plan, site, 'taxiway-a', 'taxiway', tw, along(FIELD.apronTaxiway)),
    ...connectorS(site).map((s, i) =>
      road(plan, site, `connector-${i + 1}`, 'taxiway', tw, [
        [s, r1],
        [s, FIELD.apronTaxiway],
      ]),
    ),
    road(plan, site, 'curbside', 'avenue', 16, [
      [-340, FIELD.curbside],
      [470, FIELD.curbside],
    ]),
  ];
  const access = accessRoad(plan, site);
  return access ? [...roads, access] : roads;
}

/** From the arterial point nearest the curbside to the curbside itself, if one is in reach. */
function accessRoad(plan: WorldPlan, site: Site): Road | undefined {
  const [cx, cz] = site.world(0, FIELD.curbside);
  let best: Vec3 | undefined,
    distance = Infinity;
  for (const r of plan.roads)
    if (r.class === 'highway' || r.class === 'secondary')
      for (const p of r.points) {
        const d = Math.hypot(p[0] - cx, p[2] - cz);
        if (d < distance) [best, distance] = [p, d];
      }
  if (!best) return undefined;
  const [s, t] = site.local(best[0], best[2]),
    foot = Math.min(Math.max(s, -340), 470);
  if (Math.abs(t - FIELD.curbside) < 8 + 1) return undefined;
  return road(
    plan,
    site,
    'access',
    'secondary',
    12,
    [
      [s, t],
      [foot, FIELD.curbside],
    ],
    50,
  );
}
