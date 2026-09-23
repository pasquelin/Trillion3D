/**
 * What every tower is made of: a granite podium with a glass lobby that reaches 4 m under the
 * ground (so a sloping plot never shows a gap), stacked curtain-wall sections that step back or
 * twist, a cornice slab on each, and a crown. A tower is data (`TowerSpec`); `towerProp` builds
 * it and reports what placement needs: its ground footprint and its flat roof, if any.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, extrude, prop, transform, type Point2 } from '../../props/index.ts';
import type { Xz } from './frame.ts';
import { curtainWall, edgesOf, punchedWall, rectangle } from './facade.ts';
import { CITY } from './surfaces.ts';

/** Metres under the ground every building's foundation reaches. */
export const FOUNDATION = 4;
export const PODIUM = 7;
const FLOOR = 4;

type Section = { outline: readonly Point2[]; height: number };

export type TowerSpec = {
  id: string;
  glass: Surface;
  mullion: Surface;
  bay: number;
  podium: Xz;
  sections: readonly Section[];
  /** Crown parts, built on the top of the last section (their y = 0 is that top). */
  crown?: (top: number) => MeshPart[];
  /** Half extents of the flat roof rooftop equipment may use, or none. */
  roof?: Xz;
  /** A rendered wall with punched windows and balconies instead of a curtain wall. */
  punched?: { wall: Surface; floor: number };
  lit: number;
  seed: number;
};

/** A built tower: the prop and what placement reads from it. */
export type Tower = { prop: PropMesh; half: Xz; height: number; roof?: { y: number; half: Xz } };

/** An outline turned by `angle` about the tower axis. */
export const twist = (outline: readonly Point2[], angle: number): Point2[] =>
  outline.map(([x, z]) => [
    x * Math.cos(angle) - z * Math.sin(angle),
    x * Math.sin(angle) + z * Math.cos(angle),
  ]);

/** One section's walls: a curtain wall, or a rendered body with punched windows and balconies. */
function walls(
  spec: TowerSpec,
  section: Section,
  y: number,
  height: number,
  seed: number,
): MeshPart[] {
  const edges = edgesOf(section.outline);
  if (!spec.punched)
    return edges.flatMap((edge) =>
      curtainWall(edge, y, height, {
        glass: spec.glass,
        mullion: spec.mullion,
        floor: FLOOR,
        bay: spec.bay,
        lit: spec.lit,
        seed,
      }),
    );
  const { wall, floor } = spec.punched;
  return [
    transform(extrude(wall, section.outline, height, { caps: 'none' }), { at: [0, y, 0] }),
    ...edges.flatMap((edge, i) =>
      punchedWall(edge, y, Math.round(height / floor), {
        window: 1.5,
        floor,
        bay: spec.bay,
        lit: spec.lit,
        seed: seed + i,
        balcony: spec.glass,
      }),
    ),
  ];
}

/** The tower's sections from the podium top, each with a cornice slab. */
function shaft(spec: TowerSpec): [MeshPart[], number] {
  const parts: MeshPart[] = [],
    storey = spec.punched?.floor ?? FLOOR;
  let y = PODIUM;
  spec.sections.forEach((section, i) => {
    const height = Math.max(storey, Math.round(section.height / storey) * storey);
    parts.push(...walls(spec, section, y, height, spec.seed + i * 31));
    y += height;
    parts.push(transform(extrude(spec.mullion, section.outline, 0.8), { at: [0, y, 0] }));
    y += 0.8;
  });
  return [parts, y];
}

/** Granite plinth under the ground, a double-height glass lobby, a slab over it. */
function podium([w, d]: Xz): MeshPart[] {
  const outline = rectangle(w * 2, d * 2);
  return [
    transform(box(CITY.granite, [w * 2, FOUNDATION + 0.6, d * 2]), { at: [0, -FOUNDATION, 0] }),
    ...edgesOf(outline).flatMap((edge) =>
      curtainWall(edge, 0.6, PODIUM - 1.4, {
        glass: CITY.glassDark,
        mullion: CITY.mullionDark,
        floor: PODIUM - 1.4,
        bay: 4,
        lit: 0.7,
        seed: 7,
      }),
    ),
    transform(box(CITY.granite, [w * 2 + 1.2, 0.8, d * 2 + 1.2]), { at: [0, PODIUM - 0.8, 0] }),
  ];
}

export function towerProp(spec: TowerSpec): Tower {
  const [parts, top] = shaft(spec);
  const crown = (spec.crown?.(top) ?? []).map((part) => transform(part, { at: [0, top, 0] }));
  const all = [...podium(spec.podium), ...parts, ...crown];
  const height = all.reduce((h, p) => {
    for (let v = 1; v < p.positions.length; v += 3) h = Math.max(h, p.positions[v]);
    return h;
  }, 0);
  return {
    prop: prop(spec.id, all),
    half: spec.podium,
    height,
    ...(spec.roof ? { roof: { y: top, half: spec.roof } } : {}),
  };
}

/** A parapet ring around a flat roof of `w` × `d`, and a plant room on it. */
export function flatRoof(w: number, d: number, s: Surface): MeshPart[] {
  const t = 0.3,
    h = 1.2;
  return [
    transform(box(s, [w, h, t]), { at: [0, 0, -d / 2 + t / 2] }),
    transform(box(s, [w, h, t]), { at: [0, 0, d / 2 - t / 2] }),
    transform(box(s, [t, h, d - 2 * t]), { at: [-w / 2 + t / 2, 0, 0] }),
    transform(box(s, [t, h, d - 2 * t]), { at: [w / 2 - t / 2, 0, 0] }),
    transform(box(CITY.renderGrey, [w * 0.3, 4, d * 0.25]), { at: [w * 0.3, 0, -d * 0.3] }),
  ];
}
