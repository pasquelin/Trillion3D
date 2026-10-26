import { BOUNCE_SETTINGS } from './contracts.ts'
import { boxDiagonal } from '../../../math/src/geometry/box.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'

/**
 * Probe levels: nested cubes of cells centred on the eye, finer near it.
 *
 * Each level is a cube of `cascadeSize` cells a side whose cell is `cascadeBase` times the one of
 * the level before: the first is 2 × `cascadeHalfExtentMetres` over `cascadeSize`, 1.04 m by default,
 * and the four cover 25, 50, 100 and 200 m around the eye. A cube follows the eye, snapped to its
 * own cells: it slides by whole cells, and a cell keeps its place in the world while it stays inside.
 * The size of the scene, the size of the streets, enter nowhere: a street is as many cells across
 * as its width over a metre, wherever the scene lies and however large it is.
 *
 * Probes live at the centre of a cell, `(cell + ½) · spacing`, on a lattice of the world. A cell is
 * stored by its remainder modulo the side, so that sliding by one cell changes only the cells that
 * enter: the others keep their place in every table that names them (`pool/poolWgsl.ts` of the browser engine).
 *
 * Nothing here names a scene: a viewpoint, an extent, published settings.
 */
export interface BounceCascadeLevel {
  /** Side of the level's cell, in meters. */
  spacing: number
  /** World cell index of the level's lowest cell, on each axis. */
  base: [number, number, number]
}

/** The levels of probes around the eye. */
export interface BounceCascades {
  /** Cells along one axis of a level. */
  size: number
  /** Cells of a level. */
  cells: number
  /** Probes alive at most: the pool. */
  probes: number
  /** Each level, finest first. */
  levels: BounceCascadeLevel[]
  /** Ray reach: the extent's diagonal, beyond which there is nothing to hit, or `rayReachMetres`. */
  reach: number
  /** Places the reach on a new extent. */
  replan(bounds: readonly number[]): void
  /**
   * Repositions every level around a viewpoint. Returns true when at least one base cell
   * index changed: the only signal a slide needs, costing no GPU readback.
   */
  follow(viewpoint: ArrayLike<number>): boolean
  /** Whether the cell `x, y, z` is inside the level's cube now. */
  holds(level: number, x: number, y: number, z: number): boolean
}

/** Side of the cell of level `level`. */
export function cellSpacing(level: number) {
  const { cascadeHalfExtentMetres, cascadeSize, cascadeBase } = BOUNCE_SETTINGS
  return ((2 * cascadeHalfExtentMetres) / cascadeSize) * cascadeBase ** level
}

/** The reach of a ray over `bounds`: past the extent's diagonal there is nothing to hit, and past
 *  `rayReachMetres` the sky answers. */
const reachOf = (bounds: readonly number[]) =>
  Math.min(boxDiagonal(bounds) * BOUNCE_SETTINGS.rayReachFraction, BOUNCE_SETTINGS.rayReachMetres)

/** The lowest cell index of a level of cell `spacing` centred on `viewpoint`, on each axis. */
function centredBase(spacing: number, viewpoint: ArrayLike<number>): [number, number, number] {
  const half = BOUNCE_SETTINGS.cascadeSize / 2
  return [0, 1, 2].map((axis) => Math.floor(viewpoint[axis] / spacing) - half) as [
    number,
    number,
    number,
  ]
}

/** The levels of probes around the eye, first centred on the middle of `bounds`. */
export function createBounceCascades(bounds: readonly number[]): BounceCascades {
  const { cascadeLevels, cascadeSize, probePool } = BOUNCE_SETTINGS
  const middle = [0, 1, 2].map((axis) => (bounds[axis] + bounds[3 + axis]) / 2)
  const levels: BounceCascadeLevel[] = Array.from({ length: cascadeLevels }, (_, level) => {
    const spacing = cellSpacing(level)
    return { spacing, base: centredBase(spacing, middle) }
  })
  const cascades: BounceCascades = {
    size: cascadeSize,
    cells: cascadeSize ** 3,
    probes: probePool,
    levels,
    reach: reachOf(bounds),
    replan(nextBounds) {
      cascades.reach = reachOf(nextBounds)
    },
    follow(viewpoint) {
      let moved = false
      for (const level of levels) {
        const base = centredBase(level.spacing, viewpoint)
        if (!sameValues(base, level.base)) moved = true
        level.base = base
      }
      return moved
    },
    holds(level, x, y, z) {
      const { base } = levels[level]
      return (
        x >= base[0] &&
        x < base[0] + cascadeSize &&
        y >= base[1] &&
        y < base[1] + cascadeSize &&
        z >= base[2] &&
        z < base[2] + cascadeSize
      )
    },
  }
  return cascades
}
