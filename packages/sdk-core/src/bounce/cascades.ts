import { BOUNCE_SETTINGS } from './contracts.ts';

/**
 * Probe cascades: nested probe cubes, from tightest around camera to largest over full scene.
 *
 * A single grid across a city extent spends most probes on sky and puts none where the image needs them.
 * Cascades invert that: each level bears the same probe count, and spacing doubles between levels,
 * so probe density decreases with camera distance exactly as the image requires. The last level does not
 * follow the camera: it is fixed in world space and covers the full proxy extent, so that
 * no part of the scene falls out of range of a probe.
 *
 * Two properties drive the rest. Probes of a level live on a **global lattice**,
 * at points `(gridIndex + ½) · spacing`: a probe never moves, and moving the camera only
 * shifts grid cells in and out. And a cell is indexed in the buffer by its modulo remainder of
 * the cube side: when the cascade shifts by one cell, only probes of the entering slice
 * change cells; all others keep theirs along with work already done.
 *
 * Nothing here names a scene: an extent, a viewpoint, two published bounds.
 */
export interface BounceCascadeLevel {
  /** Spacing of this level, in meters. */
  spacing: number;
  /** World cell index carried by the level's zero-index probe, on each axis. */
  base: [number, number, number];
  /** False for the last level, which remains fixed in world space. */
  moving: boolean;
}

/** The grids of light probes around the camera, finer near it. */
export interface BounceCascades {
  /** Probes along one axis and per level. */
  size: number;
  /** Probes per level. */
  probesPerLevel: number;
  /** Probes in all. */
  probes: number;
  /** Each level. */
  levels: BounceCascadeLevel[];
  /** Ray reach: extent diagonal, beyond which there is nothing to hit. */
  reach: number;
  /** Work batch probes per frame, by level: published shares applied to a total batch. */
  shareOf(total: number): number[];
  /**
   * Repositions mobile levels around a viewpoint. Returns true when at least one base cell
   * index changed: this is the only signal convergence needs to restart, costing
   * no GPU readback.
   */
  follow(viewpoint: ArrayLike<number>): boolean;
}

/**
 * Spacing of each level: finest doubled at each step.
 *
 * The cascade stops at the first level that already covers the full extent — beyond, an extra level
 * would see nothing the previous one didn't, costing a pass. A small scene thus has
 * only one level, fixed, while a city has four. The last level, regardless of rank,
 * expands to cover the extent: no scene part remains out of reach of a probe.
 */
function spacingsOf(bounds: readonly number[]): number[] {
  const { cascadeLevels, cascadeSize, cascadeSpacingMetres, cascadeLayersAcross } = BOUNCE_SETTINGS;
  const sizes = [0, 1, 2].map((axis) => Math.max(bounds[3 + axis] - bounds[axis], 1e-3));
  const extent = Math.max(...sizes);
  // The finest level never exceeds its ceiling and tightens until it retains enough
  // layers across the thinnest scene dimension.
  // A cube of `cascadeSize` probes only covers `cascadeSize - 3` useful cells: one boundary cell
  // on each side, plus one because a probe is at the center of its cell.
  const useful = cascadeSize - 3;
  // The finest spacing is also the one that, doubled at each step, allows the last level
  // to cover the extent: all spacings are power-of-two multiples of the finest, and the
  // occupancy map of a level is the exact reduction of the previous level's map.
  const finest = Math.max(
    Math.min(cascadeSpacingMetres, Math.min(...sizes) / cascadeLayersAcross),
    extent / (useful * 2 ** (cascadeLevels - 1)),
  );
  const spacings: number[] = [];
  for (let level = 0; level < cascadeLevels; level++) {
    spacings.push(finest * 2 ** level);
    if (spacings[level] * useful >= extent) break;
  }
  return spacings;
}

/** Base cell indices of the three axes, from each axis cell index. */
function baseOf(cellOf: (axis: number) => number): [number, number, number] {
  return [cellOf(0), cellOf(1), cellOf(2)];
}

/**
 * Base cell index of a level placed on the extent: one cell before it. Without this boundary,
 * a ground point offset along its normal would fall outside the level, yielding zero bounce.
 */
function fixedBase(spacing: number, bounds: readonly number[]) {
  return baseOf((axis) => Math.floor(bounds[axis] / spacing) - 1);
}

/** Base cell index of a level following camera: cube is centered on viewpoint. */
function movingBase(spacing: number, viewpoint: ArrayLike<number>) {
  const half = BOUNCE_SETTINGS.cascadeSize / 2;
  return baseOf((axis) => Math.floor(viewpoint[axis] / spacing) - half);
}

/** The probe grids that cover a scene's box. */
export function createBounceCascades(bounds: readonly number[]): BounceCascades {
  const size = BOUNCE_SETTINGS.cascadeSize;
  const probesPerLevel = size * size * size;
  const spacings = spacingsOf(bounds);
  const levels: BounceCascadeLevel[] = spacings.map((spacing, level) => ({
    spacing,
    base: fixedBase(spacing, bounds),
    moving: level < spacings.length - 1,
  }));
  const shares = BOUNCE_SETTINGS.cascadeShares.slice(0, levels.length);
  const weight = shares.reduce((sum, share) => sum + share, 0) || 1;
  return {
    size,
    probesPerLevel,
    probes: probesPerLevel * levels.length,
    levels,
    reach:
      Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) *
      BOUNCE_SETTINGS.rayReachFraction,
    shareOf(total) {
      // At least one probe per level: a level left with nothing by rounding would never
      // converge, and the last level — carrying background geometry — would be lost.
      return shares.map((share) => Math.max(1, Math.round((total * share) / weight)));
    },
    follow(viewpoint) {
      let moved = false;
      for (const level of levels) {
        if (!level.moving) continue;
        const base = movingBase(level.spacing, viewpoint);
        if (base.some((value, axis) => value !== level.base[axis])) moved = true;
        level.base = base;
      }
      return moved;
    },
  };
}
