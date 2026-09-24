/**
 * Where the countryside meets water: stone arch bridges on the plan's bridges (one 12 m span
 * repeated and stretched to each crossing), and a plank jetty on the lake with a lantern at its end.
 */
import type { Bridge, MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  prop,
  quads,
  SURFACES,
  transform,
  type PropLamp,
} from '../../props/index.ts';
import { LAND } from './ground.ts';
import type { Lake, Site } from './site.ts';

const { wood, darkMetal, emissiveLamp } = SURFACES;
/** One bridge span: its length along Z and its deck width along X, metres. */
const SPAN = { length: 12, width: 8 };
const DECK = 0.6,
  PIER = 2,
  FOOT = 8;

/** One arch span, deck top at y = 0: a pier at its +Z end, the arch opening before it. */
export function bridgeSpan(): PropMesh {
  const half = SPAN.width / 2,
    from = -SPAN.length / 2,
    to = SPAN.length / 2 - PIER,
    rise = 2.8,
    steps = 10,
    arch = Array.from({ length: steps + 1 }, (_, k) => {
      const z = from + ((to - from) * k) / steps,
        t = (2 * (z - from)) / (to - from) - 1;
      return [z, -DECK - 1.2 - rise * t * t] as const;
    });
  const faces: Vec3[][] = [],
    soffit: Vec3[][] = [];
  for (let k = 0; k < steps; k++) {
    const [z0, y0] = arch[k],
      [z1, y1] = arch[k + 1];
    faces.push([
      [half, y1, z1],
      [half, y0, z0],
      [half, -DECK, z0],
      [half, -DECK, z1],
    ]);
    faces.push([
      [-half, y0, z0],
      [-half, y1, z1],
      [-half, -DECK, z1],
      [-half, -DECK, z0],
    ]);
    soffit.push([
      [-half, y0, z0],
      [half, y0, z0],
      [half, y1, z1],
      [-half, y1, z1],
    ]);
  }
  const parapet = (side: number): MeshPart[] => [
    transform(box(LAND.stone, [0.45, 0.9, SPAN.length]), { at: [side * (half - 0.22), 0, 0] }),
    transform(box(LAND.stone, [0.6, 0.15, SPAN.length]), { at: [side * (half - 0.22), 0.9, 0] }),
  ];
  return prop('countryside/bridge-span', [
    transform(box(LAND.cobble, [SPAN.width, DECK, SPAN.length]), { at: [0, -DECK, 0] }),
    quads(LAND.stone, faces),
    quads(LAND.stone, soffit),
    transform(box(LAND.stone, [SPAN.width + 0.4, FOOT - DECK, PIER]), {
      at: [0, -FOOT, SPAN.length / 2 - PIER / 2],
    }),
    ...parapet(-1),
    ...parapet(1),
  ]);
}

/** Spans laid along one of the plan's bridges, stretched to its length and width, its deck kept clear. */
export function placeBridge(site: Site, bridge: Bridge) {
  const [fx, fy, fz] = bridge.from,
    [tx, ty, tz] = bridge.to,
    length = Math.hypot(tx - fx, tz - fz),
    count = Math.max(1, Math.round(length / SPAN.length)),
    yaw = Math.atan2(tx - fx, tz - fz),
    scale = [(bridge.width + 1.2) / SPAN.width, 1, length / (count * SPAN.length)] as const,
    deck = {
      x: (fx + tx) / 2,
      z: (fz + tz) / 2,
      hx: (bridge.width + 1.2) / 2,
      hz: length / 2,
      yaw,
    };
  // A bridge is built whole or not at all: two plan bridges on one crossing keep the first.
  if (!site.free(deck, { onRoad: true, inWater: true })) return;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    site.place('countryside/bridge-span', fx + (tx - fx) * t, fz + (tz - fz) * t, yaw, {
      scale,
      seat: { y: fy + (ty - fy) * t },
      name: `countryside/${bridge.id}/span-${i}`,
      onRoad: true,
      inWater: true,
    });
  }
  site.take(deck);
}

const JETTY = { length: 28, width: 2.4, deck: 0.9 };

/** A plank jetty along +Z from its shore end: boards on posts, a lantern at the far end. */
export function jetty(): [PropMesh, PropLamp[]] {
  const { length, width } = JETTY,
    boards = Array.from({ length: Math.floor(length / 0.32) }, (_, i) =>
      transform(box(wood, [width, 0.08, 0.28]), { at: [0, 0, 0.16 + i * 0.32] }),
    ),
    posts = Array.from({ length: Math.floor(length / 4) + 1 }, (_, i) =>
      [-1, 1].map((s) =>
        transform(cylinder(wood, 0.13, 4.1, { segments: 8 }), {
          at: [s * (width / 2 + 0.1), -3, i * 4],
        }),
      ),
    ).flat(),
    end: Vec3 = [width / 2 - 0.2, 3.1, length - 0.6];
  return [
    prop('countryside/jetty', [
      ...boards,
      ...[-1, 1].map((s) =>
        transform(box(wood, [0.12, 0.2, length]), {
          at: [s * (width / 2 - 0.1), -0.2, length / 2],
        }),
      ),
      ...posts,
      transform(cylinder(darkMetal, 0.06, 3, { segments: 8 }), { at: [end[0], 0.08, end[2]] }),
      transform(box(emissiveLamp, [0.25, 0.35, 0.25]), { at: [end[0], 3.08, end[2]] }),
    ]),
    [
      {
        id: 'lantern',
        type: 'point',
        offset: [end[0], 3.25, end[2]],
        color: [1, 0.8, 0.55],
        intensity: 120,
        range: 15,
        night: true,
      },
    ],
  ];
}

/** The jetty on a lake, running from the shore toward the centre; its shore end, or undefined. */
export function placeJetty(site: Site, lake: Lake, angle: number) {
  const dx = Math.cos(angle),
    dz = Math.sin(angle),
    x = lake.x + dx * (lake.radius + 3),
    z = lake.z + dz * (lake.radius + 3),
    yaw = Math.atan2(-dx, -dz),
    placed = site.place('countryside/jetty', x, z, yaw, {
      seat: { y: lake.level + JETTY.deck },
      name: `countryside/${lake.id}/jetty`,
      inWater: true,
    });
  if (!placed) return undefined;
  site.place('motorboat', x - dx * 20 + dz * 3.5, z - dz * 20 - dx * 3.5, yaw, {
    seat: { y: lake.level },
    name: `countryside/${lake.id}/boat`,
    inWater: true,
  });
  return placed;
}
