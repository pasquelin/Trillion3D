/**
 * Plants from rules: a trunk grows branches, which grow branches, down to twigs; each branch is
 * a tapered tube bending under its own weight, and the twigs carry leaves. A leaf is a folded
 * four-triangle blade on a surface named `card/…`, the one kind of surface written
 * double-sided. Everything comes from the seed: the same rule and seed give the same bytes.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { meshPart } from './geometry.ts';
import { hash01 } from './noise.ts';
import { tube } from './round.ts';
import { add, cross, scale, unit } from './vector.ts';

/** One value per branch level, trunk first. */
type PerLevel = readonly number[];

export type GrowthRule = {
  /** Branch lengths (m) and base radii (m) per level. */
  length: PerLevel;
  radius: PerLevel;
  /** Children each branch of the level grows, and where along it they start (0–1). */
  children: PerLevel;
  start: PerLevel;
  /**
   * Per child level (index 0 = the trunk's children): the angle between a child and its parent
   * (rad), and how much the child bends up (+) or down (−) along its length.
   */
  spread: PerLevel;
  bend: PerLevel;
  /** Tube sides per level. */
  sides: PerLevel;
  /** How much shorter children grow toward the parent's tip (0 none, 1 vanishing: a cone). */
  apical: number;
  /** Leaves per twig, their length and width (m). */
  leaves: number;
  leaf: readonly [length: number, width: number];
};

export type Branch = { points: Vec3[]; radii: number[]; level: number };

/** A direction `angle` away from `axis`, turned `azimuth` around it. */
function tilt(axis: Vec3, angle: number, azimuth: number): Vec3 {
  const side = unit(cross(axis, Math.abs(axis[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0])),
    other = cross(axis, side),
    around = add(scale(side, Math.cos(azimuth)), other, Math.sin(azimuth));
  return unit(add(scale(axis, Math.cos(angle)), around, Math.sin(angle)));
}

/** Every branch of a plant grown from `rule`, the trunk rising from the origin along +Y. */
export function grow(rule: GrowthRule, seed: number): Branch[] {
  const branches: Branch[] = [];
  let serial = 0;
  const shoot = (origin: Vec3, direction: Vec3, level: number, length: number, radius: number) => {
    const id = serial++,
      stations = Math.max(3, Math.round(4 + (length * 1.5) / (level + 1))),
      points: Vec3[] = [origin],
      radii: number[] = [radius];
    let dir = direction;
    for (let s = 1; s <= stations; s++) {
      const wobble: Vec3 = [
        hash01(seed, id, s, 1) - 0.5,
        hash01(seed, id, s, 2) - 0.5,
        hash01(seed, id, s, 3) - 0.5,
      ];
      dir = unit(
        add(
          add(dir, [0, (level ? rule.bend[level - 1] : 0) / stations, 0]),
          wobble,
          0.25 / stations + (0.05 * level) / stations,
        ),
      );
      points.push(add(points[s - 1], dir, length / stations));
      radii.push(radius * (1 - 0.65 * (s / stations)));
    }
    branches.push({ points, radii, level });
    if (level + 1 >= rule.length.length) return;
    const count = rule.children[level];
    for (let c = 0; c < count; c++) {
      const t =
          rule.start[level] +
          (1 - rule.start[level]) * ((c + hash01(seed, id, c, 4) * 0.8) / count),
        at = Math.min(stations - 1, Math.floor(t * stations)),
        azimuth = c * 2.39996 + hash01(seed, id, c, 5) * 0.6,
        spread = rule.spread[level] * (0.8 + 0.4 * hash01(seed, id, c, 6)),
        childLength =
          rule.length[level + 1] * (1 - rule.apical * t) * (0.75 + 0.5 * hash01(seed, id, c, 7)),
        from = unit(add(points[at + 1], points[at], -1));
      shoot(
        points[at],
        tilt(from, spread, azimuth),
        level + 1,
        childLength,
        Math.min(rule.radius[level + 1], radii[at] * 0.8),
      );
    }
  };
  shoot([0, 0, 0], [0, 1, 0], 0, rule.length[0], rule.radius[0]);
  return branches;
}

/** The branches as tubes, one part for the wood. */
export const wood = (surface: Surface, branches: readonly Branch[], rule: GrowthRule): MeshPart[] =>
  branches.map((b) => tube(surface, b.points, b.radii, { segments: rule.sides[b.level] }));

/** Triangles gathered for one part. */
export type Sheet = { positions: number[]; indices: number[] };

/**
 * One folded leaf blade from `base` along `dir`, its face toward `up`: a base, a raised midrib
 * point, a tip and two edges — four triangles.
 */
export function blade(out: Sheet, base: Vec3, dir: Vec3, up: Vec3, length: number, width: number) {
  const side = unit(cross(dir, up)),
    tip = add(base, dir, length),
    mid = add(base, dir, length * 0.45),
    first = out.positions.length / 3;
  out.positions.push(
    ...base,
    ...add(mid, up, width * 0.12),
    ...tip,
    ...add(mid, side, width * 0.5),
    ...add(mid, side, -width * 0.5),
  );
  for (const k of [0, 3, 1, 1, 3, 2, 0, 1, 4, 1, 2, 4]) out.indices.push(first + k);
}

/**
 * Leaf blades along the outer part of every twig (the deepest level), facing broadly up and
 * out.
 */
export function foliage(
  surface: Surface,
  branches: readonly Branch[],
  rule: GrowthRule,
  seed: number,
): MeshPart {
  const deepest = rule.length.length - 1,
    sheet: Sheet = { positions: [], indices: [] },
    [length, width] = rule.leaf;
  branches.forEach((twig, n) => {
    if (twig.level !== deepest) return;
    for (let l = 0; l < rule.leaves; l++) {
      const t = 0.35 + 0.65 * ((l + hash01(seed, n, l, 1)) / rule.leaves),
        s = Math.min(twig.points.length - 2, Math.floor(t * (twig.points.length - 1))),
        along = unit(add(twig.points[s + 1], twig.points[s], -1)),
        dir = tilt(along, 0.5 + 0.7 * hash01(seed, n, l, 2), l * 2.39996 + hash01(seed, n, l, 3)),
        lift: Vec3 = [hash01(seed, n, l, 4) - 0.5, 0, hash01(seed, n, l, 5) - 0.5],
        up = unit(add(cross(dir, cross([0, 1, 0], dir)), lift, 0.6)),
        size = 0.75 + 0.5 * hash01(seed, n, l, 6);
      blade(sheet, twig.points[s + 1], dir, up, length * size, width * size);
    }
  });
  return meshPart(surface, sheet.positions, sheet.indices);
}
